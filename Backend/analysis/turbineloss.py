"""
Turbine Long-Term Gross Energy Analysis Endpoint
=================================================
Add this to your app.py file
"""

import base64
import io
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from pydantic import BaseModel, Field, field_validator
from typing import Annotated, List, Dict, Optional
from fastapi import HTTPException
from openoa.analysis.turbine_long_term_gross_energy import TurbineLongTermGrossEnergy
from openoa.plant import PlantData
from sklearn.metrics import r2_score

# ─────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────

class TurbineGrossEnergyConfig(BaseModel):
    """Configuration for Turbine Long-Term Gross Energy analysis."""
    
    UQ: Annotated[bool, Field(
        description="Enable uncertainty quantification using Monte Carlo",
    )] = True
    
    num_sim: Annotated[int, Field(
        ge=100, le=20000,
        description="Number of Monte Carlo simulations",
    )] = 500
    
    uncertainty_scada: Annotated[float, Field(
        ge=0.001, le=0.02,
        description="SCADA data uncertainty (fraction)",
    )] = 0.005
    
    wind_bin_threshold_min: Annotated[float, Field(
        ge=0.5, le=5.0,
        description="Minimum wind bin threshold (std deviations)",
    )] = 1.0
    
    wind_bin_threshold_max: Annotated[float, Field(
        ge=0.5, le=5.0,
        description="Maximum wind bin threshold (std deviations)",
    )] = 3.0
    
    max_power_filter_min: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Minimum power filter threshold",
    )] = 0.8
    
    max_power_filter_max: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Maximum power filter threshold",
    )] = 0.9
    
    correction_threshold_min: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Minimum correction threshold",
    )] = 0.85
    
    correction_threshold_max: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Maximum correction threshold",
    )] = 0.95
    
    @field_validator('wind_bin_threshold_max')
    def validate_wind_bin_range(cls, v, info):
        if 'wind_bin_threshold_min' in info.data:
            if v <= info.data['wind_bin_threshold_min']:
                raise ValueError('wind_bin_threshold_max must be > min')
        return v
    
    @field_validator('max_power_filter_max')
    def validate_power_filter_range(cls, v, info):
        if 'max_power_filter_min' in info.data:
            if v <= info.data['max_power_filter_min']:
                raise ValueError('max_power_filter_max must be > min')
        return v
    
    @field_validator('correction_threshold_max')
    def validate_correction_range(cls, v, info):
        if 'correction_threshold_min' in info.data:
            if v <= info.data['correction_threshold_min']:
                raise ValueError('correction_threshold_max must be > min')
        return v


class TurbineResult(BaseModel):
    """Results for a single turbine."""
    turbine_id: str
    turbine_name: str
    gross_energy_mwh: float
    data_flagged_pct: float
    data_imputed_pct: float
    model_r2: float
    status: str  # 'excellent', 'good', 'fair', 'poor'
    health_pct: float


class MonthlyData(BaseModel):
    """Monthly energy data."""
    month: str
    turbine_data: Dict[str, float]


class TurbineGrossEnergyResponse(BaseModel):
    """Complete response for turbine gross energy analysis."""
    
    # Summary statistics
    summary: Dict[str, float]
    
    # Per-turbine results
    turbine_results: List[TurbineResult]
    
    # Monthly data
    monthly_data: List[MonthlyData]
    
    # Uncertainty data (if UQ enabled)
    uncertainty: Optional[Dict[str, any]]
    
    # Reanalysis comparison
    reanalysis_products: List[str]
    
    # Plots
    plots: Dict[str, Optional[str]]
    
    # Configuration used
    config: Dict[str, any]


# ─────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────

def plot_to_base64(fig) -> str:
    """Convert matplotlib figure to base64 string."""
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return img_base64


def calculate_turbine_health(r2: float, flagged_pct: float, imputed_pct: float) -> tuple[str, float]:
    """
    Calculate turbine health status and percentage.
    
    Args:
        r2: Model R² score
        flagged_pct: Percentage of data flagged
        imputed_pct: Percentage of data imputed
    
    Returns:
        (status, health_pct): Status string and health percentage
    """
    # Health formula: weighted average
    r2_score = r2 * 100  # Convert to percentage
    data_quality = 100 - flagged_pct  # Less flagged = better
    imputation_penalty = max(0, 100 - (imputed_pct * 2))  # Penalize high imputation
    
    health_pct = (
        r2_score * 0.5 +  # 50% weight on model fit
        data_quality * 0.3 +  # 30% weight on data quality
        imputation_penalty * 0.2  # 20% weight on imputation
    )
    
    # Determine status
    if health_pct >= 90:
        status = 'excellent'
    elif health_pct >= 75:
        status = 'good'
    elif health_pct >= 60:
        status = 'fair'
    else:
        status = 'poor'
    
    return status, health_pct


def create_power_curve_plot(analysis: TurbineLongTermGrossEnergy, turbine_id: str) -> str:
    """Create power curve plot for a specific turbine."""
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)
    
    df = analysis.scada_dict[turbine_id]
    
    # Plot flagged data (red)
    flagged = df[df['flag_final']]
    ax.scatter(
        flagged['WMET_HorWdSpd'],
        flagged['WTUR_W'],
        c='#ef4444',
        alpha=0.3,
        s=10,
        label='Flagged Data'
    )
    
    # Plot valid data (green)
    valid = df[~df['flag_final']]
    ax.scatter(
        valid['WMET_HorWdSpd'],
        valid['WTUR_W'],
        c='#22c55e',
        alpha=0.5,
        s=10,
        label='Valid Data'
    )
    
    ax.set_xlabel('Wind Speed (m/s)', fontsize=11)
    ax.set_ylabel('Power (kW)', fontsize=11)
    ax.set_title(f'Power Curve - {turbine_id}', fontsize=13, fontweight='bold')
    ax.legend()
    ax.grid(True, alpha=0.3)
    
    return plot_to_base64(fig)


def create_gross_energy_distribution_plot(plant_gross: np.ndarray) -> str:
    """Create histogram of gross energy distribution."""
    fig, ax = plt.subplots(figsize=(10, 6), dpi=150)
    
    plant_gross_gwh = plant_gross.flatten()
    
    # Histogram
    ax.hist(
        plant_gross_gwh,
        bins=30,
        alpha=0.7,
        color='#3b82f6',
        edgecolor='#1e40af'
    )
    
    # Add percentile lines
    p10 = np.percentile(plant_gross_gwh, 10)
    p50 = np.percentile(plant_gross_gwh, 50)
    p90 = np.percentile(plant_gross_gwh, 90)
    
    ax.axvline(p10, color='#ef4444', linestyle='--', linewidth=2, label=f'P10: {p10:.1f} GWh')
    ax.axvline(p50, color='#22c55e', linestyle='--', linewidth=2, label=f'P50: {p50:.1f} GWh')
    ax.axvline(p90, color='#a855f7', linestyle='--', linewidth=2, label=f'P90: {p90:.1f} GWh')
    
    ax.set_xlabel('Annual Gross Energy (GWh)', fontsize=11)
    ax.set_ylabel('Frequency', fontsize=11)
    ax.set_title('Distribution of Annual Gross Energy (Monte Carlo)', fontsize=13, fontweight='bold')
    ax.legend()
    ax.grid(True, alpha=0.3)
    
    return plot_to_base64(fig)


def create_turbine_comparison_plot(turbine_results: List[TurbineResult]) -> str:
    """Create bar chart comparing turbines."""
    fig, ax = plt.subplots(figsize=(12, 6), dpi=150)
    
    turbine_ids = [t.turbine_id for t in turbine_results]
    energies = [t.gross_energy_mwh / 1000 for t in turbine_results]  # Convert to GWh
    
    # Color by status
    colors = []
    for t in turbine_results:
        if t.status == 'excellent':
            colors.append('#22c55e')
        elif t.status == 'good':
            colors.append('#3b82f6')
        elif t.status == 'fair':
            colors.append('#f97316')
        else:
            colors.append('#ef4444')
    
    bars = ax.bar(turbine_ids, energies, color=colors, alpha=0.8)
    
    ax.set_xlabel('Turbine ID', fontsize=11)
    ax.set_ylabel('Gross Energy (GWh)', fontsize=11)
    ax.set_title('Turbine-by-Turbine Gross Energy Comparison', fontsize=13, fontweight='bold')
    ax.grid(True, alpha=0.3, axis='y')
    plt.xticks(rotation=45, ha='right')
    
    # Add legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor='#22c55e', label='Excellent'),
        Patch(facecolor='#3b82f6', label='Good'),
        Patch(facecolor='#f97316', label='Fair'),
        Patch(facecolor='#ef4444', label='Poor')
    ]
    ax.legend(handles=legend_elements, loc='upper right')
    
    plt.tight_layout()
    return plot_to_base64(fig)


def create_monthly_heatmap(monthly_df: pd.DataFrame) -> str:
    """Create monthly energy heatmap."""
    fig, ax = plt.subplots(figsize=(14, 8), dpi=150)
    
    # Create heatmap
    im = ax.imshow(monthly_df.T.values, aspect='auto', cmap='YlGnBu')
    
    # Set ticks
    ax.set_xticks(np.arange(len(monthly_df.index)))
    ax.set_yticks(np.arange(len(monthly_df.columns)))
    ax.set_xticklabels(monthly_df.index.strftime('%b'))
    ax.set_yticklabels(monthly_df.columns)
    
    # Colorbar
    cbar = plt.colorbar(im, ax=ax)
    cbar.set_label('Energy (MWh)', fontsize=11)
    
    ax.set_xlabel('Month', fontsize=11)
    ax.set_ylabel('Turbine ID', fontsize=11)
    ax.set_title('Monthly Gross Energy by Turbine', fontsize=13, fontweight='bold')
    
    plt.tight_layout()
    return plot_to_base64(fig)


# ─────────────────────────────────────────────────────────────────
# MAIN ENDPOINT
# ─────────────────────────────────────────────────────────────────

async def run_turbine_gross_energy_analysis(
    config: TurbineGrossEnergyConfig,
    plant: PlantData,
    re_analysis
) -> TurbineGrossEnergyResponse:
    """
    Run Turbine Long-Term Gross Energy analysis.
    
    This endpoint:
    1. Initializes TurbineLongTermGrossEnergy with configuration
    2. Filters and processes turbine data
    3. Fits GAM models for each turbine
    4. Calculates long-term gross energy estimates
    5. Quantifies uncertainty via Monte Carlo (if enabled)
    6. Returns comprehensive results with visualizations
    """
    
    try:
        # ── Step 1: Build configuration tuples ───────────────────
        if config.UQ:
            wind_bin_threshold = (config.wind_bin_threshold_min, config.wind_bin_threshold_max)
            max_power_filter = (config.max_power_filter_min, config.max_power_filter_max)
            correction_threshold = (config.correction_threshold_min, config.correction_threshold_max)
        else:
            # Use mean values when UQ disabled
            wind_bin_threshold = (config.wind_bin_threshold_min + config.wind_bin_threshold_max) / 2
            max_power_filter = (config.max_power_filter_min + config.max_power_filter_max) / 2
            correction_threshold = (config.correction_threshold_min + config.correction_threshold_max) / 2
        
        # ── Step 2: Initialize analysis ──────────────────────────
        analysis = TurbineLongTermGrossEnergy(
            plant=plant,
            UQ=config.UQ,
            reanalysis_products=re_analysis,
            num_sim=config.num_sim if config.UQ else 1,
            uncertainty_scada=config.uncertainty_scada,
            wind_bin_threshold=wind_bin_threshold,
            max_power_filter=max_power_filter,
            correction_threshold=correction_threshold,
        )
        
        # ── Step 3: Run analysis ──────────────────────────────────
        analysis.run()
        
        # ── Step 4: Extract results ───────────────────────────────
        
        # Summary statistics
        plant_gross_gwh = analysis.plant_gross.flatten()
        
        summary = {
            "total_gross_energy_gwh": float(np.mean(plant_gross_gwh)),
            "p10_gwh": float(np.percentile(plant_gross_gwh, 10)) if config.UQ else float(plant_gross_gwh[0]),
            "p50_gwh": float(np.percentile(plant_gross_gwh, 50)) if config.UQ else float(plant_gross_gwh[0]),
            "p90_gwh": float(np.percentile(plant_gross_gwh, 90)) if config.UQ else float(plant_gross_gwh[0]),
            "std_gwh": float(np.std(plant_gross_gwh)) if config.UQ else 0.0,
            "num_simulations": config.num_sim if config.UQ else 1,
            "num_turbines": len(analysis.turbine_ids),
        }
        
        # Per-turbine results
        turbine_results = []
        for turbine_id in analysis.turbine_ids:
            # Get turbine gross energy (annual average)
            turb_gross_mwh = analysis.turb_lt_gross[turbine_id].sum() * 12 / len(analysis.turb_lt_gross)
            
            # Calculate data quality metrics
            scada_df = analysis.scada_dict[turbine_id]
            total_points = len(scada_df)
            flagged_points = scada_df['flag_final'].sum()
            flagged_pct = (flagged_points / total_points * 100) if total_points > 0 else 0
            
            # Get imputation percentage
            scada_valid_turb = analysis.scada_valid[
                analysis.scada_valid.index.get_level_values('asset_id') == turbine_id
            ]
            imputed_days = (scada_valid_turb['energy_corrected'] != scada_valid_turb['energy_imputed']).sum()
            total_days = len(scada_valid_turb)
            imputed_pct = (imputed_days / total_days * 100) if total_days > 0 else 0
            
            # Calculate model R²
            model_df = analysis.turbine_model_dict[turbine_id]
            if len(model_df) > 0:
                predicted = analysis._model_results[turbine_id](
                    model_df['WMETR_HorWdSpd'],
                    model_df['WMETR_HorWdDir'],
                    model_df['WMETR_AirDen']
                )
                r2 = r2_score(model_df['energy_imputed'], predicted)
            else:
                r2 = 0.0
            
            # Calculate health status
            status, health_pct = calculate_turbine_health(r2, flagged_pct, imputed_pct)
            
            turbine_results.append(TurbineResult(
                turbine_id=turbine_id,
                turbine_name=f"Turbine {turbine_id}",
                gross_energy_mwh=float(turb_gross_mwh),
                data_flagged_pct=float(flagged_pct),
                data_imputed_pct=float(imputed_pct),
                model_r2=float(r2),
                status=status,
                health_pct=float(health_pct)
            ))
        
        # Monthly data
        turb_mo = analysis.turb_lt_gross.resample('MS').sum()
        turb_mo_avg = turb_mo.groupby(turb_mo.index.month).mean()
        
        monthly_data = []
        for month_num in range(1, 13):
            if month_num in turb_mo_avg.index:
                month_name = pd.Timestamp(year=2000, month=month_num, day=1).strftime('%b')
                turbine_data_dict = turb_mo_avg.loc[month_num].to_dict()
                monthly_data.append(MonthlyData(
                    month=month_name,
                    turbine_data={k: float(v) for k, v in turbine_data_dict.items()}
                ))
        
        # Uncertainty data
        uncertainty = None
        if config.UQ:
            uncertainty = {
                "distribution": plant_gross_gwh.tolist(),
                "p5": float(np.percentile(plant_gross_gwh, 5)),
                "p10": float(np.percentile(plant_gross_gwh, 10)),
                "p25": float(np.percentile(plant_gross_gwh, 25)),
                "p50": float(np.percentile(plant_gross_gwh, 50)),
                "p75": float(np.percentile(plant_gross_gwh, 75)),
                "p90": float(np.percentile(plant_gross_gwh, 90)),
                "p95": float(np.percentile(plant_gross_gwh, 95)),
                "mean": float(np.mean(plant_gross_gwh)),
                "std": float(np.std(plant_gross_gwh)),
                "sources": {
                    "scada_uncertainty": config.uncertainty_scada,
                    "wind_bin_threshold": f"{config.wind_bin_threshold_min}-{config.wind_bin_threshold_max}σ",
                    "power_filter": f"{config.max_power_filter_min*100:.0f}%-{config.max_power_filter_max*100:.0f}%",
                    "correction_threshold": f"{config.correction_threshold_min*100:.0f}%-{config.correction_threshold_max*100:.0f}%"
                }
            }
        
        # Reanalysis products
        reanalysis_products = list(plant.reanalysis.keys())
        
        # ── Step 5: Generate plots ───────────────────────────────
        plots = {}
        
        # Plot 1: Gross energy distribution
        if config.UQ and len(plant_gross_gwh) > 1:
            plots['gross_energy_distribution'] = create_gross_energy_distribution_plot(analysis.plant_gross)
        else:
            plots['gross_energy_distribution'] = None
        
        # Plot 2: Turbine comparison
        plots['turbine_comparison'] = create_turbine_comparison_plot(turbine_results)
        
        # Plot 3: Power curve for first turbine (example)
        first_turbine = analysis.turbine_ids[0]
        plots['power_curve_example'] = create_power_curve_plot(analysis, first_turbine)
        
        # Plot 4: Monthly heatmap
        plots['monthly_heatmap'] = create_monthly_heatmap(turb_mo_avg)
        
        # ── Step 6: Build response ───────────────────────────────
        response = TurbineGrossEnergyResponse(
            summary=summary,
            turbine_results=turbine_results,
            monthly_data=monthly_data,
            uncertainty=uncertainty,
            reanalysis_products=reanalysis_products,
            plots=plots,
            config=config.model_dump()
        )
        
        return response
        
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Turbine Gross Energy analysis failed: {str(e)}\n{traceback.format_exc()}"
        )


# ─────────────────────────────────────────────────────────────────
# ADD THIS TO YOUR app.py:
# ─────────────────────────────────────────────────────────────────

"""
@app.post("/api/turbine-gross-energy", tags=["Turbine Analysis"])
async def analyze_turbine_gross_energy(config: TurbineGrossEnergyConfig):
    # TODO: Get plant from session/database
    # plant = get_plant_from_session()
    
    return await run_turbine_gross_energy_analysis(config, plant)
"""