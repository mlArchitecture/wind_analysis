"""
ADD THIS TO app.py - Electrical Losses Analysis Endpoint
=========================================================

This endpoint should be added to your existing app.py file.
"""

# ─────────────────────────────────────────────────────────────────
# ADD THESE IMPORTS (if not already present)
# ─────────────────────────────────────────────────────────────────

import base64
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
import io
import matplotlib
from pydantic import BaseModel, Field, field_validator,validator
from typing import Annotated
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from openoa.analysis.electrical_losses import ElectricalLosses
from openoa.plant import PlantData

# ─────────────────────────────────────────────────────────────────
# PYDANTIC MODEL FOR ELECTRICAL LOSSES REQUEST
# ─────────────────────────────────────────────────────────────────

class ElectricalLossesConfig(BaseModel):
    """Electrical Losses analysis configuration parameters."""
    
    UQ: Annotated[bool, Field(
        description="Enable uncertainty quantification using Monte Carlo",
    )] = True
    
    num_sim: Annotated[int, Field(
        ge=100, le=20000,
        description="Number of Monte Carlo simulations (only if UQ=True)",
        examples=[500, 1000, 5000],
    )] = 500
    
    uncertainty_meter: Annotated[float, Field(
        ge=0.001, le=0.02,
        description="Revenue meter uncertainty (fraction)",
    )] = 0.005
    
    uncertainty_scada: Annotated[float, Field(
        ge=0.001, le=0.02,
        description="SCADA data uncertainty (fraction)",
    )] = 0.005
    
    uncertainty_correction_threshold_min: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Minimum data availability threshold",
    )] = 0.9
    
    uncertainty_correction_threshold_max: Annotated[float, Field(
        ge=0.5, le=1.0,
        description="Maximum data availability threshold",
    )] = 0.995


# ─────────────────────────────────────────────────────────────────
# HELPER FUNCTION (if not already present)
# ─────────────────────────────────────────────────────────────────

def plot_to_base64(fig) -> str:
    """
    Convert matplotlib figure to base64-encoded PNG string.
    
    Args:
        fig: matplotlib Figure object
        
    Returns:
        str: Base64-encoded PNG image
    """
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return img_base64


# ─────────────────────────────────────────────────────────────────
# ELECTRICAL LOSSES ENDPOINT - ADD THIS TO app.py
# ─────────────────────────────────────────────────────────────────


async def run_electrical_losses_analysis(config: ElectricalLossesConfig,plant:PlantData):
    """
    **Run Electrical Losses analysis** on previously uploaded and refined plant data.
    
    This endpoint performs the following:
    1. Loads the refined PlantData from the session/database
    2. Initializes ElectricalLosses with user configuration
    3. Processes SCADA and meter data
    4. Calculates electrical losses (with or without uncertainty quantification)
    5. Generates plots and summary statistics
    6. Returns results with base64-encoded plots
    
    **Prerequisites**: 
    - Data must be uploaded via `/upload-and-refine` endpoint first
    - Both SCADA and meter data must be available
    
    **Returns**:
    - Average electrical loss (%)
    - Total turbine and meter energy (GWh)
    - Monthly loss timeseries plot
    - Statistical distribution (if UQ enabled)
    - Data quality metrics
    """
    
    try:
        # ── Step 1: Get refined plant data ────────────────────────
        # TODO: Retrieve plant from session/database
        # For now, you'll need to implement session management
        # Example: plant = get_plant_from_session(session_id)
        
        
        
        # ── Step 2: Initialize Electrical Losses ──────────────────
        
        # Build uncertainty correction threshold
        if config.UQ:
            uncertainty_correction_threshold = (
                config.uncertainty_correction_threshold_min,
                config.uncertainty_correction_threshold_max
            )
        else:
            # Use mean value when UQ is disabled
            uncertainty_correction_threshold = (
                config.uncertainty_correction_threshold_min + 
                config.uncertainty_correction_threshold_max
            ) / 2.0
        
        el_analysis = ElectricalLosses(
            plant=plant,
            UQ=config.UQ,
            num_sim=config.num_sim if config.UQ else 1,
            uncertainty_meter=config.uncertainty_meter,
            uncertainty_scada=config.uncertainty_scada,
            uncertainty_correction_threshold=uncertainty_correction_threshold,
        )
        
        # ── Step 3: Run the analysis ─────────────────────────────
        el_analysis.run()
        
        # ── Step 4: Extract results ──────────────────────────────
        
        # Get electrical losses array
        losses = el_analysis.electrical_losses.flatten()
        
        # Calculate summary statistics
        loss_mean = float(losses.mean())
        loss_std = float(losses.std()) if config.UQ else 0.0
        loss_median = float(np.median(losses)) if config.UQ else loss_mean
        
        if config.UQ:
            loss_p5 = float(np.percentile(losses, 5))
            loss_p95 = float(np.percentile(losses, 95))
        else:
            loss_p5 = loss_mean
            loss_p95 = loss_mean
        
        # Get total energies (from last simulation or single run)
        total_turbine_energy = float(el_analysis.total_turbine_energy)  # MWh
        total_meter_energy = float(el_analysis.total_meter_energy)  # MWh
        energy_lost = total_turbine_energy - total_meter_energy  # MWh
        
        # Get data quality metrics
        total_days = len(el_analysis.scada_daily)
        complete_days = len(el_analysis.scada_full_count)
        data_completeness = (complete_days / total_days * 100) if total_days > 0 else 0
        
        # Get date range
        start_date = str(el_analysis.scada_daily.index.min().date())
        end_date = str(el_analysis.scada_daily.index.max().date())
        
        # Get number of turbines
        num_turbines = plant.n_turbines
        
        # ── Step 5: Generate plots ───────────────────────────────
        
        # Plot 1: Monthly Losses Timeseries
        fig_monthly, ax_monthly = el_analysis.plot_monthly_losses(return_fig=True)
        plot_monthly_losses = plot_to_base64(fig_monthly)
        
        # Plot 2: Loss Distribution (only if UQ enabled)
        plot_loss_distribution = None
        if config.UQ and len(losses) > 1:
            fig_dist, ax_dist = plt.subplots(figsize=(8, 6), dpi=150)
            
            # Histogram
            ax_dist.hist(
                losses * 100,
                bins=30,
                alpha=0.7,
                color='#7c3aed',
                edgecolor='#5b21b6',
                label='Loss Distribution'
            )
            
            # Add mean line
            ax_dist.axvline(
                loss_mean * 100,
                color='#c026d3',
                linestyle='--',
                linewidth=2,
                label=f'Mean: {loss_mean*100:.2f}%'
            )
            
            # Add median line
            ax_dist.axvline(
                loss_median * 100,
                color='#e879f9',
                linestyle=':',
                linewidth=2,
                label=f'Median: {loss_median*100:.2f}%'
            )
            
            ax_dist.set_xlabel('Electrical Loss (%)', fontsize=11)
            ax_dist.set_ylabel('Frequency', fontsize=11)
            ax_dist.set_title('Distribution of Electrical Losses', fontsize=13, fontweight='bold')
            ax_dist.legend()
            ax_dist.grid(True, alpha=0.3)
            
            fig_dist.tight_layout()
            plot_loss_distribution = plot_to_base64(fig_dist)
        
        # ── Step 6: Build response ───────────────────────────────
        response = {
            "status": "success",
            
            # Summary Statistics
            "loss_mean": loss_mean,
            "loss_std": loss_std,
            "loss_median": loss_median,
            "loss_p5": loss_p5,
            "loss_p95": loss_p95,
            
            # Energy Values (in MWh)
            "total_turbine_energy": total_turbine_energy,
            "total_meter_energy": total_meter_energy,
            "energy_lost": energy_lost,
            
            # Data Quality
            "start_date": start_date,
            "end_date": end_date,
            "total_days": total_days,
            "complete_days": complete_days,
            "data_completeness": data_completeness,
            "num_turbines": num_turbines,
            
            # Configuration
            "num_sim": config.num_sim if config.UQ else 1,
            
            # Plots (Base64 encoded PNG images)
            "plot_monthly_losses": plot_monthly_losses,
            "plot_loss_distribution": plot_loss_distribution,
        }
        
        return response
        
    
    except Exception as e:
        import traceback
        raise HTTPException(
            status_code=500,
            detail=f"Electrical Losses analysis failed: {str(e)}\n{traceback.format_exc()}"
        )


# ─────────────────────────────────────────────────────────────────
# EXAMPLE RESPONSE STRUCTURE
# ─────────────────────────────────────────────────────────────────

"""
Expected Response Format:
{
    "status": "success",
    
    // Summary Statistics
    "loss_mean": 0.0252,           // 2.52% average loss
    "loss_std": 0.0012,            // ±0.12% standard deviation
    "loss_median": 0.0251,         // 2.51% median
    "loss_p5": 0.0230,             // 2.30% (5th percentile)
    "loss_p95": 0.0274,            // 2.74% (95th percentile)
    
    // Energy Values (MWh)
    "total_turbine_energy": 125430.5,
    "total_meter_energy": 122269.2,
    "energy_lost": 3161.3,
    
    // Data Quality
    "start_date": "2022-01-01",
    "end_date": "2024-12-31",
    "total_days": 1096,
    "complete_days": 1042,
    "data_completeness": 95.1,
    "num_turbines": 45,
    
    // Configuration
    "num_sim": 500,
    
    // Plots (Base64 encoded)
    "plot_monthly_losses": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_loss_distribution": "iVBORw0KGgoAAAANSUhEUgAA..."
}
"""