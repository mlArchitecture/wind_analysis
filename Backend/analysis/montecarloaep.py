"""
BACKEND ENDPOINT FOR MONTE CARLO ANALYSIS
==========================================

This file documents the expected backend endpoint and response structure
for the Monte Carlo AEP analysis.

ENDPOINT:
---------
POST /run-monte-carlo

REQUEST BODY (JSON):
--------------------
{
    "num_sim": 500,
    "time_resolution": "MS",  // "MS" | "D" | "h"
    "reg_model": "lin",  // "lin" | "gam" | "gbm" | "etr"
    "uncertainty_meter": 0.005,
    "uncertainty_losses": 0.05,
    "uncertainty_windiness_min": 10,
    "uncertainty_windiness_max": 20,
    "uncertainty_loss_max_min": 10,
    "uncertainty_loss_max_max": 20,
    "uncertainty_nan_energy": 0.01,
    "outlier_detection": false,
    "uncertainty_outlier_min": 1.0,
    "uncertainty_outlier_max": 3.0,
    "reg_temperature": false,
    "reg_wind_direction": false,
    "apply_iav": true,
    "reanalysis_era5": true,
    "reanalysis_merra2": true,
    "end_date_lt": ""  // Optional: "YYYY-MM-DD" or empty string
}

RESPONSE (JSON):
----------------
{
    "status": "success",
    
    // Summary Statistics
    "aep_mean": 285.4,
    "aep_std": 12.3,
    "aep_p50": 285.1,
    "aep_p95": 297.7,
    
    "avail_mean": 0.052,  // 5.2%
    "avail_std": 0.008,
    
    "curt_mean": 0.031,  // 3.1%
    "curt_std": 0.005,
    
    "lt_por_ratio_mean": 1.05,
    "lt_por_ratio_std": 0.02,
    
    "iav_mean": 0.087,
    "iav_std": 0.003,
    
    "capacity_factor": 38.2,
    
    // Model Performance
    "r2_mean": 0.94,
    "r2_min": 0.89,
    "r2_max": 0.97,
    
    "mse_mean": 2.3,
    "mse_std": 0.5,
    
    "n_points_mean": 145,
    "n_points_min": 130,
    "n_points_max": 160,
    
    "num_sim": 500,
    
    // Data Quality
    "start_date": "2022-01-01",
    "end_date": "2024-12-31",
    "data_availability": 98.5,
    "flagged_periods": 12,
    "outliers_detected": 23,
    
    // Plots (Base64 encoded PNG images)
    "plot_aep_distribution": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_avail_distribution": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_curt_distribution": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_energy_timeseries": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_losses_timeseries": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_reanalysis_windspeed": "iVBORw0KGgoAAAANSUhEUgAA...",
    "plot_energy_vs_windspeed": "iVBORw0KGgoAAAANSUhEUgAA..."
}

IMPLEMENTATION EXAMPLE (FastAPI):
----------------------------------
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import base64
import io
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from openoa.analysis.aep import MonteCarloAEP
from openoa import PlantData
from analysis.plant import plant_formation  # Your plant formation function


router = APIRouter()


class MonteCarloRequest(BaseModel):
    
    num_sim: int = 500
    time_resolution: str = "MS"
    reg_model: str = "lin"
    uncertainty_meter: float = 0.005
    uncertainty_losses: float = 0.05
    uncertainty_windiness_min: int = 10
    uncertainty_windiness_max: int = 20
    uncertainty_loss_max_min: int = 10
    uncertainty_loss_max_max: int = 20
    uncertainty_nan_energy: float = 0.01
    outlier_detection: bool = False
    uncertainty_outlier_min: float = 1.0
    uncertainty_outlier_max: float = 3.0
    reg_temperature: bool = False
    reg_wind_direction: bool = False
    apply_iav: bool = True
    
    end_date_lt: str = ""


def plot_to_base64(fig):
    """Convert matplotlib figure to base64 string"""
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return img_base64



async def run_monte_carlo_analysis(plant: PlantData, request: MonteCarloRequest,re_analysis):
    """
    Run Monte Carlo AEP analysis on uploaded plant data.
    
    This endpoint assumes that plant data has already been uploaded
    and processed via the /upload-and-refine endpoint.
    """
    
    try:
       
       
        
        # Initialize Monte Carlo AEP analysis
        mc_aep = MonteCarloAEP(
            plant=plant,  # Your PlantData object
            reg_temperature=request.reg_temperature,
            reg_wind_direction=request.reg_wind_direction,
            reanalysis_products=re_analysis,
            uncertainty_meter=request.uncertainty_meter,
            uncertainty_losses=request.uncertainty_losses,
            uncertainty_windiness=(
                request.uncertainty_windiness_min, 
                request.uncertainty_windiness_max
            ),
            uncertainty_loss_max=(
                request.uncertainty_loss_max_min, 
                request.uncertainty_loss_max_max
            ),
            outlier_detection=request.outlier_detection,
            uncertainty_outlier=(
                request.uncertainty_outlier_min, 
                request.uncertainty_outlier_max
            ),
            uncertainty_nan_energy=request.uncertainty_nan_energy,
            time_resolution=request.time_resolution,
            end_date_lt=request.end_date_lt if request.end_date_lt else None,
            reg_model=request.reg_model,
            apply_iav=request.apply_iav,
        )
        
        # Run the analysis
        mc_aep.run(
            num_sim=request.num_sim,
            progress_bar=False  # Disable for API
        )

        results=mc_aep.run_AEP_monte_carlo(progress_bar=True)#result is a dataframe
        
        
        
        # Calculate summary statistics
        aep_mean = results['aep_GWh'].mean()
        aep_std = results['aep_GWh'].std()
        aep_p50 = results['aep_GWh'].quantile(0.5)
        aep_p95 = results['aep_GWh'].quantile(0.95)
        
        avail_mean = results['avail_pct'].mean()
        avail_std = results['avail_pct'].std()
        
        curt_mean = results['curt_pct'].mean()
        curt_std = results['curt_pct'].std()
        
        lt_por_ratio_mean = results['lt_por_ratio'].mean()
        lt_por_ratio_std = results['lt_por_ratio'].std()
        
        iav_mean = results['iav'].mean()
        iav_std = results['iav'].std()
        
        r2_mean = results['r2'].mean()
        r2_min = results['r2'].min()
        r2_max = results['r2'].max()
        
        mse_mean = results['mse'].mean()
        mse_std = results['mse'].std()
        
        n_points_mean = results['n_points'].mean()
        n_points_min = int(results['n_points'].min())
        n_points_max = int(results['n_points'].max())
        
        # Calculate capacity factor (example calculation)
        capacity_mw = plant.metadata.capacity / 1000.0  # Convert to MW
        hours_per_year = 8760
        capacity_factor = (aep_mean / (capacity_mw * hours_per_year)) * 100
        
        # Generate plots and convert to base64
        
        # 1. AEP Distribution
        fig_aep, ax_aep = mc_aep.plot_result_aep_distributions(return_fig=True)
        plot_aep = plot_to_base64(fig_aep)
        
        # 2. Energy Time Series
        fig_energy, ax_energy = mc_aep.plot_aggregate_plant_data_timeseries(return_fig=True)
        plot_energy = plot_to_base64(fig_energy)
        
        # 3. Reanalysis Wind Speed
        fig_wind, ax_wind = mc_aep.plot_normalized_monthly_reanalysis_windspeed(return_fig=True)
        plot_wind = plot_to_base64(fig_wind)
        
        # 4. Energy vs Wind Speed
        outlier_threshold = (request.uncertainty_outlier_min + request.uncertainty_outlier_max) / 2
        fig_scatter, ax_scatter = mc_aep.plot_reanalysis_gross_energy_data(
            outlier_threshold=outlier_threshold,
            return_fig=True
        )
        plot_scatter = plot_to_base64(fig_scatter)

        #long_term_calculating _losses
        mc_aep.sample_long_term_reanalysis()
        
        # Build response
        response = {
            "status": "success",
            
            # Summary Statistics
            "aep_mean": float(aep_mean),
            "aep_std": float(aep_std),
            "aep_p50": float(aep_p50),
            "aep_p95": float(aep_p95),
            
            "avail_mean": float(avail_mean),
            "avail_std": float(avail_std),
            
            "curt_mean": float(curt_mean),
            "curt_std": float(curt_std),
            
            "lt_por_ratio_mean": float(lt_por_ratio_mean),
            "lt_por_ratio_std": float(lt_por_ratio_std),
            
            "iav_mean": float(iav_mean),
            "iav_std": float(iav_std),
            
            "capacity_factor": float(capacity_factor),
            
            # Model Performance
            "r2_mean": float(r2_mean),
            "r2_min": float(r2_min),
            "r2_max": float(r2_max),
            
            "mse_mean": float(mse_mean),
            "mse_std": float(mse_std),
            
            "n_points_mean": float(n_points_mean),
            "n_points_min": n_points_min,
            "n_points_max": n_points_max,
            
            "num_sim": request.num_sim,
            
            # Data Quality
            "start_date": str(mc_aep.start_por.date()),
            "end_date": str(mc_aep.end_por.date()),
            "data_availability": 98.5,  # Calculate from actual data
            "flagged_periods": 12,  # Calculate from actual data
            "outliers_detected": 23,  # Calculate from actual data
            
            # Plots (Base64 encoded)
            "plot_aep_distribution": plot_aep,
            "plot_avail_distribution": None,  # TODO: Generate separate plots
            "plot_curt_distribution": None,   # TODO: Generate separate plots
            "plot_energy_timeseries": plot_energy,
            "plot_losses_timeseries": None,   # TODO: Extract from combined plot
            "plot_reanalysis_windspeed": plot_wind,
            "plot_energy_vs_windspeed": plot_scatter,
        }
        
        return response
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Monte Carlo analysis failed: {str(e)}"
        )


# Add this router to your main FastAPI app
# app.include_router(router)