"""
app.py
------
FastAPI application for OpenOA wind plant analysis pipeline.

POST /upload-and-refine
    - 6 CSV files as multipart/form-data keys
    - Plant metadata as form fields
    - Pydantic validates plant info
    - Per-DataFrame validators: not empty, required cols, non-negative
    - Sends to refine.refine_all()
    - Returns QA report + session_id

POST /run-monte-carlo
    - Requires session_id (header or query param)
    - Accepts MonteCarloConfig as JSON body
    - Pulls PlantData from per-session store
    - Returns AEP result

Run:   uvicorn app:app --reload --port 8000
Docs:  http://localhost:8000/docs
"""

import io
import uuid
from datetime import datetime
from typing import Annotated, Optional

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Header, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from openoa.plant import PlantData
from utils.refine import refine_all
from analysis.plant import plant_formation
from analysis.montecarloaep import run_monte_carlo_analysis
from utils.plant_data import plant_data
from analysis.electricalloss import run_electrical_losses_analysis
from analysis.turbineloss import run_turbine_gross_energy_analysis

from analysis.wakeloss import run_wake_loss_analysis
from analysis.staticyawmisalign import run_static_yaw_analysis


# ─────────────────────────────────────────────────────────────────
# APP INIT
# ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OpenOA Wind Plant Analysis API",
    description="Upload CSVs → Validate → Refine → QA Report → Analyse",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────
# PER-SESSION STORE
# ─────────────────────────────────────────────────────────────────
# Maps  session_id (str UUID)  →  {"plant": PlantData, "qa_report": ..., ...}
# Resets when the server restarts (in-memory only).

_SESSION_STORE: dict[str, dict] = {}


def _get_session(session_id: str) -> dict:
    """Retrieve a session or raise 404."""
    session = _SESSION_STORE.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Session '{session_id}' not found. "
                "Run /upload-and-refine first to obtain a valid session_id."
            ),
        )
    return session


# ─────────────────────────────────────────────────────────────────
# DATAFRAME VALIDATORS
# ─────────────────────────────────────────────────────────────────

_NON_NEGATIVE: dict[str, list[str]] = {
    "asset":             ["rated_power", "hub_height", "rotor_diameter"],
    "reanalysis_era5":   ["WMETR_HorWdSpd"],
    "reanalysis_merra2": ["WMETR_HorWdSpd"],
}


def _parse_csv(file: UploadFile, key: str) -> pd.DataFrame:
    try:
        return pd.read_csv(io.BytesIO(file.file.read()))
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"[{key}] Cannot parse '{file.filename}': {e}",
        )


def _check_not_empty(df: pd.DataFrame, key: str) -> None:
    if df.empty:
        raise HTTPException(
            status_code=422,
            detail=f"[{key}] Uploaded CSV is completely empty (0 rows).",
        )


# ─────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────


class MonteConfig(BaseModel):
    """Configuration model for Monte Carlo AEP analysis."""

    num_sim: int = Field(default=500, ge=1, description="Number of simulations to run")
    time_resolution: str = Field(default="MS", description="Time resolution (e.g., 'MS' for month start)")
    reg_model: str = Field(default="lin", description="Regression model type")
    uncertainty_meter: float = Field(default=0.005, ge=0.0, le=1.0, description="Meter uncertainty factor")
    uncertainty_losses: float = Field(default=0.05, ge=0.0, le=1.0, description="Losses uncertainty factor")
    uncertainty_windiness_min: float = Field(default=10.0, ge=0.0, description="Minimum windiness uncertainty")
    uncertainty_windiness_max: float = Field(default=20.0, ge=0.0, description="Maximum windiness uncertainty")
    uncertainty_loss_max_min: float = Field(default=10.0, ge=0.0, description="Minimum loss max uncertainty")
    uncertainty_loss_max_max: float = Field(default=20.0, ge=0.0, description="Maximum loss max uncertainty")
    uncertainty_nan_energy: float = Field(default=0.01, ge=0.0, le=1.0, description="NaN energy uncertainty factor")
    outlier_detection: bool = Field(default=False, description="Enable outlier detection")
    uncertainty_outlier_min: float = Field(default=1.0, ge=0.0, description="Minimum outlier uncertainty")
    uncertainty_outlier_max: float = Field(default=3.0, ge=0.0, description="Maximum outlier uncertainty")
    reg_temperature: bool = Field(default=False, description="Enable temperature regression")
    reg_wind_direction: bool = Field(default=False, description="Enable wind direction regression")
    apply_iav: bool = Field(default=True, description="Apply inter-annual variability")
    end_date_lt: Optional[str] = Field(default="", description="End date for long-term analysis (ISO format or empty string)")

    @field_validator("time_resolution")
    @classmethod
    def validate_time_resolution(cls, v: str) -> str:
        valid = ["D", "W", "MS", "M", "QS", "Q", "YS", "Y", "H", "10min", "30min"]
        if v not in valid:
            raise ValueError(f"time_resolution must be one of {valid}")
        return v

    @field_validator("reg_model")
    @classmethod
    def validate_reg_model(cls, v: str) -> str:
        valid = ["lin", "gam", "gbm"]
        if v not in valid:
            raise ValueError(f"reg_model must be one of {valid}")
        return v

    @field_validator("end_date_lt")
    @classmethod
    def validate_end_date(cls, v: Optional[str]) -> Optional[str]:
        if v and v.strip():
            try:
                datetime.fromisoformat(v.replace("Z", "+00:00"))
            except ValueError:
                raise ValueError("end_date_lt must be in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)")
        return v

    @model_validator(mode="after")
    def check_windiness_range(self) -> "MonteConfig":
        if self.uncertainty_windiness_min >= self.uncertainty_windiness_max:
            raise ValueError("uncertainty_windiness_max must be greater than uncertainty_windiness_min")
        return self

    @model_validator(mode="after")
    def check_loss_max_range(self) -> "MonteConfig":
        if self.uncertainty_loss_max_min >= self.uncertainty_loss_max_max:
            raise ValueError("uncertainty_loss_max_max must be greater than uncertainty_loss_max_min")
        return self

    @model_validator(mode="after")
    def check_outlier_range(self) -> "MonteConfig":
        if self.uncertainty_outlier_min >= self.uncertainty_outlier_max:
            raise ValueError("uncertainty_outlier_max must be greater than uncertainty_outlier_min")
        return self


class UQConfig(BaseModel):
    """Uncertainty Quantification configuration model."""

    UQ: bool = Field(default=True, description="Enable/disable uncertainty quantification analysis")
    num_sim: int = Field(default=500, ge=1, le=10000, description="Number of Monte Carlo simulations to run")
    uncertainty_meter: float = Field(default=0.005, ge=0.0, le=1.0, description="Meter uncertainty factor")
    uncertainty_scada: float = Field(default=0.005, ge=0.0, le=1.0, description="SCADA data uncertainty factor")
    uncertainty_correction_threshold_min: float = Field(default=0.9, ge=0.5, le=1.0, description="Minimum correction threshold")
    uncertainty_correction_threshold_max: float = Field(default=0.995, ge=0.5, le=1.0, description="Maximum correction threshold")

    @model_validator(mode="after")
    def check_threshold_range(self) -> "UQConfig":
        if self.uncertainty_correction_threshold_min >= self.uncertainty_correction_threshold_max:
            raise ValueError(
                f"uncertainty_correction_threshold_max must be greater than "
                f"uncertainty_correction_threshold_min"
            )
        return self


class AnalysisConfig(BaseModel):
    """Configuration parameters for the turbine gross energy analysis."""

    UQ: bool = Field(default=True, description="Enable Monte Carlo uncertainty quantification.")
    num_sim: Optional[int] = Field(default=500, ge=100, le=20000, description="Number of Monte Carlo simulations.")
    uncertainty_scada: float = Field(default=0.005, ge=0.001, le=0.02, description="SCADA measurement uncertainty.")
    wind_bin_threshold_min: float = Field(default=1.0, ge=0.5, le=5.0, description="Lower bound for wind bin filtering threshold.")
    wind_bin_threshold_max: float = Field(default=3.0, ge=0.5, le=5.0, description="Upper bound for wind bin filtering threshold.")
    max_power_filter_min: float = Field(default=0.8, ge=0.5, le=1.0, description="Lower bound for the maximum power filter fraction.")
    max_power_filter_max: float = Field(default=0.9, ge=0.5, le=1.0, description="Upper bound for the maximum power filter fraction.")
    correction_threshold_min: float = Field(default=0.85, ge=0.5, le=1.0, description="Lower bound for the correction threshold fraction.")
    correction_threshold_max: float = Field(default=0.95, ge=0.5, le=1.0, description="Upper bound for the correction threshold fraction.")

    @model_validator(mode="after")
    def check_wind_bin_range(self) -> "AnalysisConfig":
        if self.wind_bin_threshold_min >= self.wind_bin_threshold_max:
            raise ValueError("wind_bin_threshold_min must be less than wind_bin_threshold_max.")
        return self

    @model_validator(mode="after")
    def check_power_filter_range(self) -> "AnalysisConfig":
        if self.max_power_filter_min >= self.max_power_filter_max:
            raise ValueError("max_power_filter_min must be less than max_power_filter_max.")
        return self

    @model_validator(mode="after")
    def check_correction_threshold_range(self) -> "AnalysisConfig":
        if self.correction_threshold_min >= self.correction_threshold_max:
            raise ValueError("correction_threshold_min must be less than correction_threshold_max.")
        return self

    @model_validator(mode="after")
    def num_sim_required_when_uq_enabled(self) -> "AnalysisConfig":
        if self.UQ and self.num_sim is None:
            raise ValueError("num_sim is required when UQ is enabled.")
        return self


# ─────────────────────────────────────────────────────────────────
# POST /upload-and-refine
# ─────────────────────────────────────────────────────────────────

@app.post(
    "/upload-and-refine",
    summary="Upload CSVs, validate, and run QA refinement",
    response_description="QA report + session_id for subsequent analysis calls",
    tags=["Pipeline"],
)
async def upload_and_refine(
    # ── Plant metadata ─────────────────────────────────────────────
    name:          Annotated[str,           Form(description="Wind plant name")] = ...,
    latitude:      Annotated[float,         Form(description="Latitude -90 to 90")] = ...,
    longitude:     Annotated[float,         Form(description="Longitude -180 to 180")] = ...,
    capacity_mw:   Annotated[float,         Form(description="Capacity in MW")] = ...,
    local_tz:      Annotated[str,           Form(description="Timezone e.g. Europe/Paris")] = ...,
    analysis_type: Annotated[Optional[str], Form(description="(Optional) Analysis type")] = None,

    # ── Column name overrides ──────────────────────────────────────
    scada_time_col:           Annotated[str, Form()] = "Date_time",
    scada_id_col:             Annotated[str, Form()] = "Wind_turbine_name",
    scada_power_col:          Annotated[str, Form()] = "P_avg",
    scada_windspeed_col:      Annotated[str, Form()] = "Ws_avg",
    scada_temp_col:           Annotated[str, Form()] = "Ot_avg",
    meter_time_col:           Annotated[str, Form()] = "time",
    meter_energy_col:         Annotated[str, Form()] = "MMTR_SupWh",
    curtail_time_col:         Annotated[str, Form()] = "time",
    curtail_avail_col:        Annotated[str, Form()] = "IAVL_DnWh",
    curtail_curtail_col:      Annotated[str, Form()] = "IAVL_ExtPwrDnWh",
    reanalysis_time_col:      Annotated[str, Form()] = "time",
    reanalysis_windspeed_col: Annotated[str, Form()] = "WMETR_HorWdSpd",
    reanalysis_winddir_col:   Annotated[str, Form()] = "WMETR_HorWdDir",
    reanalysis_temp_col:      Annotated[str, Form()] = "WMETR_EnvTmp",

    # ── CSV files ──────────────────────────────────────────────────
    scada:             Annotated[UploadFile,           File(description="SCADA CSV (required)")] = ...,
    meter:             Annotated[Optional[UploadFile], File(description="Meter CSV")] = None,
    tower:             Annotated[Optional[UploadFile], File(description="Tower CSV")] = None,
    status:            Annotated[Optional[UploadFile], File(description="Status CSV")] = None,
    curtail:           Annotated[Optional[UploadFile], File(description="Curtailment CSV")] = None,
    asset:             Annotated[Optional[UploadFile], File(description="Asset CSV")] = None,
    reanalysis_era5:   Annotated[Optional[UploadFile], File(description="ERA5 CSV")] = None,
    reanalysis_merra2: Annotated[Optional[UploadFile], File(description="MERRA2 CSV")] = None,
):
    # ── Step 1: Parse CSVs ─────────────────────────────────────────
    scada_df   = _parse_csv(scada,             "scada")
    meter_df   = _parse_csv(meter,             "meter")             if meter             else None
    tower_df   = _parse_csv(tower,             "tower")             if tower             else None
    curtail_df = _parse_csv(curtail,           "curtail")           if curtail           else None
    status_df  = _parse_csv(status,            "status")            if status            else None
    asset_df   = _parse_csv(asset,             "asset")             if asset             else None
    era5_df    = _parse_csv(reanalysis_era5,   "reanalysis_era5")   if reanalysis_era5   else None
    merra2_df  = _parse_csv(reanalysis_merra2, "reanalysis_merra2") if reanalysis_merra2 else None

    # ── Step 2: Refine ─────────────────────────────────────────────
    reanalysis_dfs = {}
    if era5_df   is not None: reanalysis_dfs["era5"]   = era5_df
    if merra2_df is not None: reanalysis_dfs["merra2"] = merra2_df

    try:
        result = refine_all(
            scada_df                  = scada_df,
            local_tz                  = local_tz,
            scada_time_col            = scada_time_col,
            scada_id_col              = scada_id_col,
            scada_power_col           = scada_power_col,
            scada_windspeed_col       = scada_windspeed_col,
            scada_temp_col            = scada_temp_col,
            meter_df                  = meter_df,
            meter_time_col            = meter_time_col,
            meter_energy_col          = meter_energy_col,
            curtail_df                = curtail_df,
            curtail_time_col          = curtail_time_col,
            curtail_avail_col         = curtail_avail_col,
            curtail_curtail_col       = curtail_curtail_col,
            asset_df                  = asset_df,
            reanalysis_dfs            = reanalysis_dfs or None,
            reanalysis_time_col       = reanalysis_time_col,
            reanalysis_windspeed_col  = reanalysis_windspeed_col,
            reanalysis_winddir_col    = reanalysis_winddir_col,
            reanalysis_temp_col       = reanalysis_temp_col,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Refinement failed: {e}")

    # ── Step 3: Build PlantData and store in session ───────────────
    try:
        plant_obj = plant_data(
            latitude, longitude, name, local_tz, analysis_type,
            scada, meter, tower, curtail, status, asset, reanalysis_dfs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PlantData construction failed: {e}")

    session_id = str(uuid.uuid4())
    _SESSION_STORE[session_id] = {
        "plant":      plant_obj,
        "reanalysis": result["dataframes"]["reanalysis"],
    }

    return {
        "status":     "success",
        "session_id": session_id,
        "plant": {
            "name":        name,
            "latitude":    latitude,
            "longitude":   longitude,
            "capacity_mw": capacity_mw,
            "local_tz":    local_tz,
        },
        "datasets_received": {
            "scada":             True,
            "meter":             meter_df   is not None,
            "curtail":           curtail_df is not None,
            "asset":             asset_df   is not None,
            "reanalysis_era5":   era5_df    is not None,
            "reanalysis_merra2": merra2_df  is not None,
        },
        "qa_report": result["qa_report"],
    }


# ─────────────────────────────────────────────────────────────────
# POST /run-monte-carlo
# ─────────────────────────────────────────────────────────────────

@app.post("/run-monte-carlo", tags=["Monte Carlo"])
def run_monte_carlo(
    config: MonteConfig,
    session_id: Annotated[str, Header(
        description="Session ID returned by /upload-and-refine",
        alias="X-Session-Id",
    )],
):
    session     = _get_session(session_id)
    plant:      PlantData = session["plant"]
    re_analysis = session["reanalysis"]

    try:
        aep_result = run_monte_carlo_analysis(plant, config, re_analysis)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Monte Carlo AEP analysis failed: {e}")

    _SESSION_STORE[session_id]["monte_carlo_result"] = aep_result
    return {"status": "success", "aep_result": aep_result}


# ─────────────────────────────────────────────────────────────────
# POST /run-electrical-losses
# ─────────────────────────────────────────────────────────────────

@app.post("/run-electrical-losses", tags=["Electrical Losses"])
def run_electrical_losses(
    config: UQConfig,
    session_id: Annotated[str, Header(
        description="Session ID returned by /upload-and-refine",
        alias="X-Session-Id",
    )],
):
    session      = _get_session(session_id)
    plant: PlantData = session["plant"]

    try:
        result = run_electrical_losses_analysis(config=config, plant=plant)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Electrical losses analysis failed: {e}")

    return {"status": "success", "aep_result": result}


# ─────────────────────────────────────────────────────────────────
# POST /turbine-gross-energy
# ─────────────────────────────────────────────────────────────────

@app.post("/turbine-gross-energy", tags=["Turbine Gross Energy"])
def turbine_gross_energy(
    config: AnalysisConfig,
    session_id: Annotated[str, Header(
        description="Session ID returned by /upload-and-refine",
        alias="X-Session-Id",
    )],
):
    session      = _get_session(session_id)
    plant: PlantData = session["plant"]
    re_analysis  = session["reanalysis"]

    try:
        result = run_turbine_gross_energy_analysis(plant, config, re_analysis)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Turbine gross energy analysis failed: {e}")

    return result


# ─────────────────────────────────────────────────────────────────
# WakeLossConfig
# ─────────────────────────────────────────────────────────────────

class WakeLossConfig(BaseModel):
    """
    Input configuration for the Wake Loss analysis.
    Every field maps 1-to-1 to a parameter of the WakeLosses attrs class.
    Tuple fields (UQ ranges) are split into _min / _max pairs,
    exactly as sent by WakeLoss.jsx → buildPayload().
    """

    # ── Core ─────────────────────────────────────────────────────────
    UQ: bool = Field(default=True, description="Enable Monte Carlo uncertainty quantification.")
    num_sim: int = Field(default=100, ge=10, le=10000, description="Number of Monte Carlo simulations (only used when UQ=True).")
    start_date: Optional[str] = Field(default=None, description="Analysis start date (ISO format). None = earliest SCADA date.")
    end_date: Optional[str] = Field(default=None, description="Analysis end date (ISO format). None = latest SCADA date.")
    end_date_lt: Optional[str] = Field(default=None, description="Last date for long-term correction. None = auto from reanalysis.")
    wind_direction_col: str = Field(default="WMET_HorWdDir", description="Column name used for wind direction.")
    wind_direction_data_type: str = Field(default="scada", description="Data type for wind direction: 'scada' or 'tower'.")
    wind_direction_asset_ids: Optional[list[str]] = Field(default=None, description="Asset IDs used for mean wind direction.")
    reanalysis_products: Optional[list[str]] = Field(default=None, description="Reanalysis products to use. None = all available.")

    # ── Freestream detection ──────────────────────────────────────────
    wd_bin_width: float = Field(default=5.0, ge=0.5, le=30.0, description="Wind direction bin size (degrees).")
    freestream_sector_width_min: float = Field(default=50.0, ge=10.0, le=180.0, description="Freestream sector width lower bound (degrees).")
    freestream_sector_width_max: float = Field(default=110.0, ge=10.0, le=180.0, description="Freestream sector width upper bound (degrees).")
    freestream_power_method: str = Field(default="mean", description="Method for representative freestream power.")
    freestream_wind_speed_method: str = Field(default="mean", description="Method for representative freestream wind speed.")

    # ── Derating & curtailment correction ────────────────────────────
    correct_for_derating: bool = Field(default=True, description="Flag derated/curtailed turbines.")
    derating_filter_wind_speed_start_min: float = Field(default=4.0, ge=1.0, le=15.0, description="Derating filter wind speed lower bound (m/s).")
    derating_filter_wind_speed_start_max: float = Field(default=5.0, ge=1.0, le=15.0, description="Derating filter wind speed upper bound (m/s).")
    max_power_filter_min: float = Field(default=0.92, ge=0.5, le=1.0, description="Max power filter fraction lower bound.")
    max_power_filter_max: float = Field(default=0.98, ge=0.5, le=1.0, description="Max power filter fraction upper bound.")
    wind_bin_mad_thresh_min: float = Field(default=4.0, ge=1.0, le=20.0, description="Wind bin MAD threshold lower bound.")
    wind_bin_mad_thresh_max: float = Field(default=13.0, ge=1.0, le=20.0, description="Wind bin MAD threshold upper bound.")

    # ── Wind speed heterogeneity correction ──────────────────────────
    correct_for_ws_heterogeneity: bool = Field(default=False, description="Correct for freestream wind speed heterogeneity.")
    ws_speedup_factor_map: Optional[str] = Field(default=None, description="Path to CSV with turbine speedup factors.")

    # ── Long-term correction ─────────────────────────────────────────
    wd_bin_width_LT_corr: float = Field(default=5.0, ge=0.5, le=30.0, description="Wind direction bin size for LT correction (degrees).")
    ws_bin_width_LT_corr: float = Field(default=1.0, ge=0.5, le=5.0, description="Wind speed bin size for LT correction (m/s).")
    num_years_LT_min: int = Field(default=10, ge=1, le=30, description="Number of reanalysis years lower bound.")
    num_years_LT_max: int = Field(default=20, ge=1, le=30, description="Number of reanalysis years upper bound.")
    assume_no_wakes_high_ws_LT_corr: bool = Field(default=True, description="No-wake assumption for high wind speeds.")
    no_wakes_ws_thresh_LT_corr: float = Field(default=13.0, ge=5.0, le=25.0, description="Wind speed threshold for no-wake assumption (m/s).")
    min_ws_bin_lin_reg: float = Field(default=3.0, ge=0.0, le=10.0, description="Minimum wind speed bin for linear regression.")
    bin_count_thresh_lin_reg: int = Field(default=50, ge=5, le=500, description="Minimum samples per bin for linear regression.")

    @model_validator(mode="after")
    def check_freestream_sector_range(self) -> "WakeLossConfig":
        if self.UQ and self.freestream_sector_width_min >= self.freestream_sector_width_max:
            raise ValueError("freestream_sector_width_min must be less than freestream_sector_width_max.")
        return self

    @model_validator(mode="after")
    def check_derating_ws_range(self) -> "WakeLossConfig":
        if self.UQ and self.correct_for_derating:
            if self.derating_filter_wind_speed_start_min >= self.derating_filter_wind_speed_start_max:
                raise ValueError("derating_filter_wind_speed_start_min must be less than derating_filter_wind_speed_start_max.")
        return self

    @model_validator(mode="after")
    def check_max_power_filter_range(self) -> "WakeLossConfig":
        if self.UQ and self.correct_for_derating:
            if self.max_power_filter_min >= self.max_power_filter_max:
                raise ValueError("max_power_filter_min must be less than max_power_filter_max.")
        return self

    @model_validator(mode="after")
    def check_mad_thresh_range(self) -> "WakeLossConfig":
        if self.UQ and self.correct_for_derating:
            if self.wind_bin_mad_thresh_min >= self.wind_bin_mad_thresh_max:
                raise ValueError("wind_bin_mad_thresh_min must be less than wind_bin_mad_thresh_max.")
        return self

    @model_validator(mode="after")
    def check_num_years_LT_range(self) -> "WakeLossConfig":
        if self.UQ and self.num_years_LT_min >= self.num_years_LT_max:
            raise ValueError("num_years_LT_min must be less than num_years_LT_max.")
        return self

    @model_validator(mode="after")
    def check_heterogeneity_map(self) -> "WakeLossConfig":
        if self.correct_for_ws_heterogeneity and not self.ws_speedup_factor_map:
            raise ValueError("ws_speedup_factor_map is required when correct_for_ws_heterogeneity is True.")
        return self

    @model_validator(mode="after")
    def validate_freestream_power_method(self) -> "WakeLossConfig":
        if self.freestream_power_method not in {"mean", "median", "max"}:
            raise ValueError("freestream_power_method must be 'mean', 'median', or 'max'.")
        return self

    @model_validator(mode="after")
    def validate_freestream_ws_method(self) -> "WakeLossConfig":
        if self.freestream_wind_speed_method not in {"mean", "median"}:
            raise ValueError("freestream_wind_speed_method must be 'mean' or 'median'.")
        return self

    @model_validator(mode="after")
    def validate_wind_direction_data_type(self) -> "WakeLossConfig":
        if self.wind_direction_data_type not in {"scada", "tower"}:
            raise ValueError("wind_direction_data_type must be 'scada' or 'tower'.")
        return self


@app.post("/run-wake-losses", tags=["Wake Losses"])
def run_wake_losses(
    config: WakeLossConfig,
    session_id: Annotated[str, Header(
        description="Session ID returned by /upload-and-refine",
        alias="X-Session-Id",
    )],
):
    session    = _get_session(session_id)
    plant      = session["plant"]
    reanalysis = session["reanalysis"]

    try:
        result = run_wake_loss_analysis(plant, config, reanalysis)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Wake loss analysis failed: {e}")

    return result


# ─────────────────────────────────────────────────────────────────
# StaticYawConfig  ← mirrors DEFAULT_PARAMS in staticyaw.jsx exactly
# ─────────────────────────────────────────────────────────────────

class StaticYawConfig(BaseModel):
    """
    Input configuration for Static Yaw Misalignment analysis.
    Every field maps 1-to-1 to a parameter of the StaticYawMisalignment attrs class.
    Tuple fields (UQ ranges) are split into _min / _max pairs and a _single fallback,
    exactly as sent by staticyaw.jsx → buildPayload().
    """

    turbine_ids: Optional[list[str]] = Field(
        default=None,
        description="Turbine IDs to analyse. None = all turbines in the plant.",
    )
    UQ: bool = Field(
        default=True,
        description="Enable Monte Carlo uncertainty quantification.",
    )
    num_sim: int = Field(
        default=100, ge=10, le=10000,
        description="Monte Carlo iterations. Only used when UQ=True.",
    )
    ws_bins: list[float] = Field(
        default=[5.0, 6.0, 7.0, 8.0],
        description="Wind speed bin centres for detection (m/s).",
    )
    ws_bin_width: float = Field(
        default=1.0, gt=0,
        description="Wind speed bin half-width (m/s).",
    )
    vane_bin_width: float = Field(
        default=1.0, gt=0,
        description="Wind vane bin width (degrees).",
    )
    min_vane_bin_count: int = Field(
        default=100, ge=1,
        description="Minimum samples required in a vane bin.",
    )
    max_abs_vane_angle: float = Field(
        default=25.0, gt=0,
        description="Maximum absolute vane angle considered (degrees).",
    )
    pitch_thresh: float = Field(
        default=0.5, ge=0,
        description="Max blade pitch angle — removes above-rated timestamps (degrees).",
    )
    num_power_bins: int = Field(
        default=25, ge=2,
        description="Power bins for outlier filtering.",
    )
    min_power_filter: float = Field(
        default=0.01, ge=0, le=1,
        description="Lower power threshold as fraction of rated power.",
    )
    # UQ=True  → tuple (min, max) is passed to StaticYawMisalignment
    # UQ=False → max_power_filter_single is passed directly
    max_power_filter_min: float = Field(
        default=0.92, ge=0, le=1,
        description="Max power filter lower bound (UQ mode).",
    )
    max_power_filter_max: float = Field(
        default=0.98, ge=0, le=1,
        description="Max power filter upper bound (UQ mode).",
    )
    max_power_filter_single: float = Field(
        default=0.95, ge=0, le=1,
        description="Max power filter single value (non-UQ mode).",
    )
    # UQ=True  → tuple (min, max) is passed to StaticYawMisalignment
    # UQ=False → power_bin_mad_thresh_single is passed directly
    power_bin_mad_thresh_min: float = Field(
        default=4.0, ge=0,
        description="MAD threshold lower bound (UQ mode).",
    )
    power_bin_mad_thresh_max: float = Field(
        default=10.0, ge=0,
        description="MAD threshold upper bound (UQ mode).",
    )
    power_bin_mad_thresh_single: float = Field(
        default=7.0, ge=0,
        description="MAD threshold single value (non-UQ mode).",
    )
    use_power_coeff: bool = Field(
        default=False,
        description="Normalise power by wind speed cubed to approximate Cp.",
    )

    @model_validator(mode="after")
    def check_max_power_filter_range(self) -> "StaticYawConfig":
        if self.UQ and self.max_power_filter_min >= self.max_power_filter_max:
            raise ValueError(
                "max_power_filter_min must be less than max_power_filter_max."
            )
        return self

    @model_validator(mode="after")
    def check_mad_thresh_range(self) -> "StaticYawConfig":
        if self.UQ and self.power_bin_mad_thresh_min >= self.power_bin_mad_thresh_max:
            raise ValueError(
                "power_bin_mad_thresh_min must be less than power_bin_mad_thresh_max."
            )
        return self

    model_config = {
        "json_schema_extra": {
            "example": {
                "turbine_ids": None,
                "UQ": True,
                "num_sim": 100,
                "ws_bins": [5.0, 6.0, 7.0, 8.0],
                "ws_bin_width": 1.0,
                "vane_bin_width": 1.0,
                "min_vane_bin_count": 100,
                "max_abs_vane_angle": 25.0,
                "pitch_thresh": 0.5,
                "num_power_bins": 25,
                "min_power_filter": 0.01,
                "max_power_filter_min": 0.92,
                "max_power_filter_max": 0.98,
                "max_power_filter_single": 0.95,
                "power_bin_mad_thresh_min": 4.0,
                "power_bin_mad_thresh_max": 10.0,
                "power_bin_mad_thresh_single": 7.0,
                "use_power_coeff": False,
            }
        }
    }


# ─────────────────────────────────────────────────────────────────
# POST /static-yaw
# ─────────────────────────────────────────────────────────────────

@app.post("/static-yaw", tags=["Static Yaw Misalignment"])
def static_yaw(
    config: StaticYawConfig,                 # ← typed: FastAPI parses JSON body
    session_id: Annotated[str, Header(
        description="Session ID returned by /upload-and-refine",
        alias="X-Session-Id",
    )],
):
    session = _get_session(session_id)
    plant   = session["plant"]

    try:
        result = run_static_yaw_analysis(plant=plant, config=config)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Static yaw misalignment analysis failed: {e}",
        )

    return result


# ─────────────────────────────────────────────────────────────────
# GET /session/{session_id}
# ─────────────────────────────────────────────────────────────────

@app.get("/session/{session_id}", tags=["Session"])
def get_session_info(session_id: str):
    """Retrieve stored metadata and any cached results for a session."""
    session = _get_session(session_id)
    return {
        "session_id":         session_id,
        "plant_info":         session.get("plant_info"),
        "qa_report":          session.get("qa_report"),
        "monte_carlo_result": session.get("monte_carlo_result"),
        "eya_gap_result":     session.get("eya_gap_result"),
    }


# ─────────────────────────────────────────────────────────────────
# GET /health
# ─────────────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
def health():
    return {
        "status":          "ok",
        "service":         "OpenOA Platform",
        "active_sessions": len(_SESSION_STORE),
    }