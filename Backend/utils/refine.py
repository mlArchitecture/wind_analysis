"""
refine.py
---------
Called from app.py. Takes raw DataFrames, runs OpenOA QA + filters,
returns cleaned DataFrames + QA summary report.

Usage in app.py:
    from refine import refine_all

    result = refine_all(
        scada_df         = scada_df,
        local_tz         = "Europe/Paris",
        scada_time_col   = "Date_time",
        scada_id_col     = "Wind_turbine_name",
        scada_power_col  = "P_avg",
        scada_windspeed_col = "Ws_avg",
        scada_temp_col   = "Ot_avg",
        meter_df         = meter_df,
        curtail_df       = curtail_df,
        asset_df         = asset_df,
        reanalysis_dfs   = {"era5": era5_df, "merra2": merra2_df},
    )

    cleaned_scada = result["dataframes"]["scada"]
    qa_report     = result["qa_report"]
"""

import pandas as pd
import numpy as np
from openoa.utils import qa
from openoa.utils.filters import range_flag, unresponsive_flag


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def _safe_int(val) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _drop_duplicates(df: pd.DataFrame, time_col: str) -> pd.DataFrame:
    """Drop duplicate timestamps, keep LAST."""
    if time_col in df.columns:
        return df.drop_duplicates(subset=[time_col], keep="last")
    return df[~df.index.duplicated(keep="last")]  # index-based after UTC conversion


# ─────────────────────────────────────────────────────────────────
# SCADA
# ─────────────────────────────────────────────────────────────────

def refine_scada(
    df, local_tz, time_col, id_col,
    power_col, windspeed_col, temp_col,
    freq="10min",
    power_range=(-20.0, 2200.0),
    windspeed_range=(0.0, 50.0),
    temp_range=(-40.0, 50.0),
    unresponsive_threshold=3,
):
    report = {}
    df = df.copy()

    # 1. Convert datetime (timezone-naive)
    try:
        df = qa.convert_datetime_column(
            df=df, time_col=time_col,
            local_tz=local_tz, tz_aware=False
        )
        report["datetime_converted"] = True
    except Exception as e:
        report["datetime_converted"] = False
        report["datetime_error"] = str(e)

    # 2. Identify duplicates
    try:
        dup_orig, _, dup_utc = qa.duplicate_time_identification(
            df=df, time_col=time_col, id_col=id_col
        )
        report["duplicate_original_count"] = _safe_int(dup_orig.size)
        report["duplicate_utc_count"] = _safe_int(dup_utc.size if dup_utc is not None else 0)
    except Exception as e:
        report["duplicate_check_error"] = str(e)

    # Drop duplicates — keep last
    before = len(df)
    df = _drop_duplicates(df, time_col)
    report["rows_dropped_duplicates"] = before - len(df)

    # 3. Time gaps
    try:
        gap_orig, _, gap_utc = qa.gap_time_identification(
            df=df, time_col=time_col, freq=freq
        )
        report["time_gaps_original_count"] = _safe_int(gap_orig.size)
        report["time_gaps_utc_count"] = _safe_int(gap_utc.size if gap_utc is not None else 0)
        if gap_utc is not None and gap_utc.size > 0:
            report["time_gap_timestamps_utc"] = gap_utc.astype(str).tolist()
    except Exception as e:
        report["gap_check_error"] = str(e)

    # 4. Range flags
    flag_cols = []
    for col, rng, fname in [
        (power_col,      power_range,      "flag_power_range"),
        (windspeed_col,  windspeed_range,  "flag_windspeed_range"),
        (temp_col,       temp_range,       "flag_temp_range"),
    ]:
        if col in df.columns:
            try:
                df[fname] = range_flag(data=df[col], lower=rng[0], upper=rng[1])
                report[f"range_flag_{fname}_count"] = int(df[fname].sum())
                flag_cols.append(fname)
            except Exception as e:
                report[f"range_flag_{fname}_error"] = str(e)

    # 5. Unresponsive sensor flags
    for col, fname in [
        (power_col,     "flag_power_unresponsive"),
        (windspeed_col, "flag_windspeed_unresponsive"),
    ]:
        if col in df.columns:
            try:
                df[fname] = unresponsive_flag(
                    data=df[col], threshold=unresponsive_threshold
                )
                report[f"unresponsive_{fname}_count"] = int(df[fname].sum())
                flag_cols.append(fname)
            except Exception as e:
                report[f"unresponsive_{fname}_error"] = str(e)

    report["flag_columns_added"] = flag_cols
    report["final_row_count"] = len(df)
    return df, report


# ─────────────────────────────────────────────────────────────────
# METER
# ─────────────────────────────────────────────────────────────────

def refine_meter(
    df, local_tz,
    time_col="time", energy_col="MMTR_SupWh",
    freq="10min", energy_range=(-100.0, 1e7),
):
    report = {}
    df = df.copy()

    try:
        df = qa.convert_datetime_column(df=df, time_col=time_col, local_tz=local_tz, tz_aware=False)
        report["datetime_converted"] = True
    except Exception as e:
        report["datetime_converted"] = False; report["datetime_error"] = str(e)

    try:
        dup_orig, _, dup_utc = qa.duplicate_time_identification(df=df, time_col=time_col, id_col=time_col)
        report["duplicate_original_count"] = _safe_int(dup_orig.size)
        report["duplicate_utc_count"] = _safe_int(dup_utc.size if dup_utc is not None else 0)
    except Exception as e:
        report["duplicate_check_error"] = str(e)

    before = len(df)
    df = _drop_duplicates(df, time_col)
    report["rows_dropped_duplicates"] = before - len(df)

    try:
        gap_orig, _, gap_utc = qa.gap_time_identification(df=df, time_col=time_col, freq=freq)
        report["time_gaps_original_count"] = _safe_int(gap_orig.size)
        report["time_gaps_utc_count"] = _safe_int(gap_utc.size if gap_utc is not None else 0)
    except Exception as e:
        report["gap_check_error"] = str(e)

    if energy_col in df.columns:
        try:
            df["flag_energy_range"] = range_flag(data=df[energy_col], lower=energy_range[0], upper=energy_range[1])
            report["range_flag_energy_count"] = int(df["flag_energy_range"].sum())
        except Exception as e:
            report["range_flag_energy_error"] = str(e)

    report["final_row_count"] = len(df)
    return df, report


# ─────────────────────────────────────────────────────────────────
# CURTAILMENT
# ─────────────────────────────────────────────────────────────────

def refine_curtail(
    df, local_tz,
    time_col="time", avail_col="IAVL_DnWh", curtail_col="IAVL_ExtPwrDnWh",
    freq="10min", avail_range=(0.0, 1e7), curtail_range=(0.0, 1e7),
):
    report = {}
    df = df.copy()

    try:
        df = qa.convert_datetime_column(df=df, time_col=time_col, local_tz=local_tz, tz_aware=False)
        report["datetime_converted"] = True
    except Exception as e:
        report["datetime_converted"] = False; report["datetime_error"] = str(e)

    try:
        dup_orig, _, dup_utc = qa.duplicate_time_identification(df=df, time_col=time_col, id_col=time_col)
        report["duplicate_original_count"] = _safe_int(dup_orig.size)
        report["duplicate_utc_count"] = _safe_int(dup_utc.size if dup_utc is not None else 0)
    except Exception as e:
        report["duplicate_check_error"] = str(e)

    before = len(df)
    df = _drop_duplicates(df, time_col)
    report["rows_dropped_duplicates"] = before - len(df)

    try:
        gap_orig, _, gap_utc = qa.gap_time_identification(df=df, time_col=time_col, freq=freq)
        report["time_gaps_original_count"] = _safe_int(gap_orig.size)
        report["time_gaps_utc_count"] = _safe_int(gap_utc.size if gap_utc is not None else 0)
    except Exception as e:
        report["gap_check_error"] = str(e)

    for col, rng, fname in [
        (avail_col,   avail_range,   "flag_availability_range"),
        (curtail_col, curtail_range, "flag_curtailment_range"),
    ]:
        if col in df.columns:
            try:
                df[fname] = range_flag(data=df[col], lower=rng[0], upper=rng[1])
                report[f"{fname}_count"] = int(df[fname].sum())
            except Exception as e:
                report[f"{fname}_error"] = str(e)

    report["final_row_count"] = len(df)
    return df, report


# ─────────────────────────────────────────────────────────────────
# ASSET
# ─────────────────────────────────────────────────────────────────

def refine_asset(
    df,
    lat_range=(-90.0, 90.0),
    lon_range=(-180.0, 180.0),
    rated_power_range=(0.0, 1e7),
):
    report = {}
    df = df.copy()

    if "asset_id" in df.columns:
        report["missing_asset_id_count"] = int(df["asset_id"].isna().sum())

    for col, rng, fname in [
        ("latitude",    lat_range,          "flag_latitude_range"),
        ("longitude",   lon_range,          "flag_longitude_range"),
        ("rated_power", rated_power_range,  "flag_rated_power_range"),
    ]:
        if col in df.columns:
            try:
                df[fname] = range_flag(data=df[col], lower=rng[0], upper=rng[1])
                report[f"{fname}_count"] = int(df[fname].sum())
            except Exception as e:
                report[f"{fname}_error"] = str(e)

    report["final_row_count"] = len(df)
    return df, report


# ─────────────────────────────────────────────────────────────────
# REANALYSIS
# ─────────────────────────────────────────────────────────────────

def refine_reanalysis(
    df, product_name, local_tz,
    time_col="time",
    windspeed_col="WMETR_HorWdSpd",
    winddir_col="WMETR_HorWdDir",
    temp_col="WMETR_EnvTmp",
    freq="1h",
    windspeed_range=(0.0, 80.0),
    winddir_range=(0.0, 360.0),
    temp_range=(200.0, 340.0),        # Kelvin
    unresponsive_threshold=3,
):
    report = {}
    df = df.copy()

    try:
        df = qa.convert_datetime_column(df=df, time_col=time_col, local_tz=local_tz, tz_aware=False)
        report["datetime_converted"] = True
    except Exception as e:
        report["datetime_converted"] = False; report["datetime_error"] = str(e)

    try:
        dup_orig, _, dup_utc = qa.duplicate_time_identification(df=df, time_col=time_col, id_col=time_col)
        report["duplicate_original_count"] = _safe_int(dup_orig.size)
        report["duplicate_utc_count"] = _safe_int(dup_utc.size if dup_utc is not None else 0)
    except Exception as e:
        report["duplicate_check_error"] = str(e)

    before = len(df)
    df = _drop_duplicates(df, time_col)
    report["rows_dropped_duplicates"] = before - len(df)

    try:
        gap_orig, _, gap_utc = qa.gap_time_identification(df=df, time_col=time_col, freq=freq)
        report["time_gaps_original_count"] = _safe_int(gap_orig.size)
        report["time_gaps_utc_count"] = _safe_int(gap_utc.size if gap_utc is not None else 0)
    except Exception as e:
        report["gap_check_error"] = str(e)

    for col, rng, fname in [
        (windspeed_col, windspeed_range, "flag_windspeed_range"),
        (winddir_col,   winddir_range,   "flag_winddir_range"),
        (temp_col,      temp_range,      "flag_temp_range"),
    ]:
        if col in df.columns:
            try:
                df[fname] = range_flag(data=df[col], lower=rng[0], upper=rng[1])
                report[f"{fname}_count"] = int(df[fname].sum())
            except Exception as e:
                report[f"{fname}_error"] = str(e)

    if windspeed_col in df.columns:
        try:
            df["flag_windspeed_unresponsive"] = unresponsive_flag(
                data=df[windspeed_col], threshold=unresponsive_threshold
            )
            report["unresponsive_windspeed_count"] = int(df["flag_windspeed_unresponsive"].sum())
        except Exception as e:
            report["unresponsive_windspeed_error"] = str(e)

    report["product"] = product_name
    report["final_row_count"] = len(df)
    return df, report


# ─────────────────────────────────────────────────────────────────
# MASTER FUNCTION  ←  called by app.py
# ─────────────────────────────────────────────────────────────────

def refine_all(
    scada_df,
    local_tz,
    scada_time_col="Date_time",
    scada_id_col="Wind_turbine_name",
    scada_power_col="P_avg",
    scada_windspeed_col="Ws_avg",
    scada_temp_col="Ot_avg",
    scada_freq="10min",
    meter_df=None,
    meter_time_col="time",
    meter_energy_col="MMTR_SupWh",
    curtail_df=None,
    curtail_time_col="time",
    curtail_avail_col="IAVL_DnWh",
    curtail_curtail_col="IAVL_ExtPwrDnWh",
    asset_df=None,
    reanalysis_dfs=None,             # {"era5": df, "merra2": df}
    reanalysis_time_col="time",
    reanalysis_windspeed_col="WMETR_HorWdSpd",
    reanalysis_winddir_col="WMETR_HorWdDir",
    reanalysis_temp_col="WMETR_EnvTmp",
) -> dict:
    """
    Returns
    -------
    {
        "dataframes": {
            "scada":      cleaned pd.DataFrame,
            "meter":      cleaned pd.DataFrame | None,
            "curtail":    cleaned pd.DataFrame | None,
            "asset":      cleaned pd.DataFrame | None,
            "reanalysis": {"era5": df | None, "merra2": df | None}
        },
        "qa_report": {
            "scada":      { ... },
            "meter":      { ... } | None,
            "curtail":    { ... } | None,
            "asset":      { ... } | None,
            "reanalysis": {"era5": { ... }, "merra2": { ... }}
        }
    }
    """
    dataframes, qa_report = {}, {}

    # SCADA (required)
    print("[refine] Processing SCADA...")
    dataframes["scada"], qa_report["scada"] = refine_scada(
        df=scada_df, local_tz=local_tz,
        time_col=scada_time_col, id_col=scada_id_col,
        power_col=scada_power_col, windspeed_col=scada_windspeed_col,
        temp_col=scada_temp_col, freq=scada_freq,
    )

    # Meter
    if meter_df is not None:
        print("[refine] Processing Meter...")
        dataframes["meter"], qa_report["meter"] = refine_meter(
            df=meter_df, local_tz=local_tz,
            time_col=meter_time_col, energy_col=meter_energy_col,
        )
    else:
        dataframes["meter"] = qa_report["meter"] = None

    # Curtailment
    if curtail_df is not None:
        print("[refine] Processing Curtailment...")
        dataframes["curtail"], qa_report["curtail"] = refine_curtail(
            df=curtail_df, local_tz=local_tz,
            time_col=curtail_time_col,
            avail_col=curtail_avail_col,
            curtail_col=curtail_curtail_col,
        )
    else:
        dataframes["curtail"] = qa_report["curtail"] = None

    # Asset
    if asset_df is not None:
        print("[refine] Processing Asset...")
        dataframes["asset"], qa_report["asset"] = refine_asset(df=asset_df)
    else:
        dataframes["asset"] = qa_report["asset"] = None

    # Reanalysis
    dataframes["reanalysis"] = {}
    qa_report["reanalysis"]  = {}
    if reanalysis_dfs:
        for name, r_df in reanalysis_dfs.items():
            if r_df is not None:
                print(f"[refine] Processing Reanalysis: {name}...")
                dataframes["reanalysis"][name], qa_report["reanalysis"][name] = refine_reanalysis(
                    df=r_df, product_name=name, local_tz=local_tz,
                    time_col=reanalysis_time_col,
                    windspeed_col=reanalysis_windspeed_col,
                    winddir_col=reanalysis_winddir_col,
                    temp_col=reanalysis_temp_col,
                )
            else:
                dataframes["reanalysis"][name] = qa_report["reanalysis"][name] = None

    print("[refine] Done.")
    return {"dataframes": dataframes, "qa_report": qa_report}