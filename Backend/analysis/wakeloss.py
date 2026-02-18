"""
analysis/wakeloss.py
────────────────────
Standalone analysis function for Wake Loss estimation using the
OpenOA WakeLosses class.

Called from app.py:
    from analysis.wakeloss import run_wake_loss_analysis
    result = run_wake_loss_analysis(plant, config, reanalysis)

Returns a dict ready to be serialised by FastAPI (JSON-safe):
  - summary numbers  (LT/POR wake losses, std devs, turbine-level)
  - base64 PNG plots (direction, wind speed — both POR + LT)
"""

import io
import base64
import logging
from typing import Optional

import matplotlib
matplotlib.use("Agg")          # non-interactive backend — must be before pyplot import
import matplotlib.pyplot as plt
import numpy as np

from openoa.plant import PlantData
from openoa.analysis import WakeLosses          # attrs-based class

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# INTERNAL HELPERS
# ─────────────────────────────────────────────────────────────────

def _fig_to_b64(fig: plt.Figure) -> str:
    """Encode a matplotlib Figure to a base64 PNG string."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    plt.close(fig)
    return b64


def _safe_float(val) -> Optional[float]:
    """Return a Python float or None — guards against np.nan / np.inf."""
    if val is None:
        return None
    f = float(val)
    return None if (np.isnan(f) or np.isinf(f)) else f


def _safe_list(arr) -> list:
    """Convert a numpy array to a JSON-safe Python list (NaN → None)."""
    if arr is None:
        return []
    return [_safe_float(v) for v in np.asarray(arr).ravel()]


def _parse_tuple_or_single(min_val, max_val, use_uq: bool):
    """
    Return a tuple (min, max) when UQ is enabled,
    or a single float when UQ is disabled.
    Mirrors WakeLosses attrs field semantics exactly.
    """
    if use_uq:
        return (float(min_val), float(max_val))
    return float(min_val)


# ─────────────────────────────────────────────────────────────────
# MAIN ANALYSIS FUNCTION
# ─────────────────────────────────────────────────────────────────

def run_wake_loss_analysis(
    plant: PlantData,
    config,                  # AnalysisConfig-like pydantic model from app.py
    reanalysis: dict,        # {"era5": pd.DataFrame, "merra2": pd.DataFrame, …}
) -> dict:
    """
    Build a WakeLosses object from ``plant`` and ``config``, run the
    analysis, generate plots, and return a JSON-serialisable result dict.

    Parameters
    ----------
    plant : PlantData
        Validated PlantData object from the session store.
    config : WakeLossConfig
        Pydantic model populated from the WakeLoss.jsx frontend payload.
    reanalysis : dict
        Reanalysis DataFrames keyed by product name (e.g. "era5", "merra2").

    Returns
    -------
    dict  with keys:
        summary, turbine_results, plots
    """

    uq: bool = config.UQ

    # ── 1. Resolve reanalysis products ──────────────────────────────
    # config.reanalysis_products is None (use all) or a list of strings
    reanalysis_products = config.reanalysis_products
    if not reanalysis_products:
        reanalysis_products = list(reanalysis.keys()) if reanalysis else ["era5", "merra2"]

    # ── 2. Resolve tuple-or-single parameters ───────────────────────
    # Each of these mirrors the WakeLosses attrs field exactly:
    # UQ=True  → tuple (lo, hi)  fed into Monte Carlo uniform sampling
    # UQ=False → single float    used directly

    freestream_sector_width = _parse_tuple_or_single(
        config.freestream_sector_width_min,
        config.freestream_sector_width_max,
        uq,
    )

    derating_filter_wind_speed_start = _parse_tuple_or_single(
        config.derating_filter_wind_speed_start_min,
        config.derating_filter_wind_speed_start_max,
        uq,
    )

    max_power_filter = _parse_tuple_or_single(
        config.max_power_filter_min,
        config.max_power_filter_max,
        uq,
    )

    wind_bin_mad_thresh = _parse_tuple_or_single(
        config.wind_bin_mad_thresh_min,
        config.wind_bin_mad_thresh_max,
        uq,
    )

    num_years_LT = _parse_tuple_or_single(
        config.num_years_LT_min,
        config.num_years_LT_max,
        uq,
    )
    # WakeLosses expects int / tuple[int,int] for num_years_LT
    if isinstance(num_years_LT, tuple):
        num_years_LT = (int(num_years_LT[0]), int(num_years_LT[1]))
    else:
        num_years_LT = int(num_years_LT)

    # ── 3. Parse optional comma-separated asset IDs ─────────────────
    wind_direction_asset_ids = config.wind_direction_asset_ids   # None or list[str]

    # ── 4. Build WakeLosses attrs object ────────────────────────────
    logger.info("Building WakeLosses object …")

    wl = WakeLosses(
        plant=plant,

        # Wind direction source
        wind_direction_col=config.wind_direction_col,
        wind_direction_data_type=config.wind_direction_data_type,
        wind_direction_asset_ids=wind_direction_asset_ids,

        # UQ / simulation count
        UQ=uq,
        num_sim=int(config.num_sim) if uq else 1,

        # Date range
        start_date=config.start_date or None,
        end_date=config.end_date or None,

        # Reanalysis
        reanalysis_products=reanalysis_products,
        end_date_lt=config.end_date_lt or None,

        # Freestream detection
        wd_bin_width=float(config.wd_bin_width),
        freestream_sector_width=freestream_sector_width,
        freestream_power_method=config.freestream_power_method,
        freestream_wind_speed_method=config.freestream_wind_speed_method,

        # Derating correction
        correct_for_derating=bool(config.correct_for_derating),
        derating_filter_wind_speed_start=derating_filter_wind_speed_start,
        max_power_filter=max_power_filter,
        wind_bin_mad_thresh=wind_bin_mad_thresh,

        # Wind speed heterogeneity
        correct_for_ws_heterogeneity=bool(config.correct_for_ws_heterogeneity),
        ws_speedup_factor_map=config.ws_speedup_factor_map or None,

        # Long-term correction
        wd_bin_width_LT_corr=float(config.wd_bin_width_LT_corr),
        ws_bin_width_LT_corr=float(config.ws_bin_width_LT_corr),
        num_years_LT=num_years_LT,
        assume_no_wakes_high_ws_LT_corr=bool(config.assume_no_wakes_high_ws_LT_corr),
        no_wakes_ws_thresh_LT_corr=float(config.no_wakes_ws_thresh_LT_corr),
        min_ws_bin_lin_reg=float(config.min_ws_bin_lin_reg),
        bin_count_thresh_lin_reg=int(config.bin_count_thresh_lin_reg),
    )

    # ── 5. Run the analysis ─────────────────────────────────────────
    logger.info("Running WakeLosses.run() …")
    wl.run()

    # ── 6. Extract scalar summary results ───────────────────────────
    # Attribute names differ between UQ and non-UQ modes:
    #   UQ=True  → wake_losses_lt_mean, wake_losses_lt_std  (scalars from MC)
    #   UQ=False → wake_losses_lt, wake_losses_por           (scalars directly)

    if uq:
        summary = {
            # Long-term corrected
            "wake_losses_lt_mean":       _safe_float(wl.wake_losses_lt_mean),
            "wake_losses_lt_std":        _safe_float(wl.wake_losses_lt_std),
            "farm_efficiency_lt_mean":   _safe_float(1.0 - wl.wake_losses_lt_mean),
            # Period of record
            "wake_losses_por_mean":      _safe_float(wl.wake_losses_por_mean),
            "wake_losses_por_std":       _safe_float(wl.wake_losses_por_std),
            "farm_efficiency_por_mean":  _safe_float(1.0 - wl.wake_losses_por_mean),
            # Mode flag
            "UQ": True,
            "num_sim": int(config.num_sim),
            "reanalysis_products": reanalysis_products,
        }
    else:
        wl_lt  = float(wl.wake_losses_lt)
        wl_por = float(wl.wake_losses_por)
        summary = {
            "wake_losses_lt_mean":       _safe_float(wl_lt),
            "wake_losses_lt_std":        None,
            "farm_efficiency_lt_mean":   _safe_float(1.0 - wl_lt),
            "wake_losses_por_mean":      _safe_float(wl_por),
            "wake_losses_por_std":       None,
            "farm_efficiency_por_mean":  _safe_float(1.0 - wl_por),
            "UQ": False,
            "num_sim": 1,
            "reanalysis_products": reanalysis_products,
        }

    # ── 7. Wind-direction-binned arrays ─────────────────────────────
    # wake_losses_*_wd shape:
    #   UQ=True  → (num_sim, n_wd_bins)   — take mean over axis 0
    #   UQ=False → (n_wd_bins,)
    if uq:
        wl_lt_wd  = np.nanmean(wl.wake_losses_lt_wd,  axis=0)
        wl_por_wd = np.nanmean(wl.wake_losses_por_wd, axis=0)
        en_lt_wd  = np.nanmean(wl.energy_lt_wd,       axis=0)
        en_por_wd = np.nanmean(wl.energy_por_wd,      axis=0)
    else:
        wl_lt_wd  = wl.wake_losses_lt_wd
        wl_por_wd = wl.wake_losses_por_wd
        en_lt_wd  = wl.energy_lt_wd
        en_por_wd = wl.energy_por_wd

    # ── 8. Wind-speed-binned arrays ──────────────────────────────────
    # wake_losses_*_ws shape:
    #   UQ=True  → (num_sim, n_ws_bins)   — take mean over axis 0
    #   UQ=False → (n_ws_bins,)
    if uq:
        wl_lt_ws  = np.nanmean(wl.wake_losses_lt_ws,  axis=0)
        wl_por_ws = np.nanmean(wl.wake_losses_por_ws, axis=0)
        en_lt_ws  = np.nanmean(wl.energy_lt_ws,       axis=0)
        en_por_ws = np.nanmean(wl.energy_por_ws,      axis=0)
    else:
        wl_lt_ws  = wl.wake_losses_lt_ws
        wl_por_ws = wl.wake_losses_por_ws
        en_lt_ws  = wl.energy_lt_ws
        en_por_ws = wl.energy_por_ws

    # ── 9. Turbine-level results ─────────────────────────────────────
    # turbine_wake_losses_lt_mean shape:
    #   UQ=True  → (num_sim, n_turbines) — take mean over axis 0
    #   UQ=False → (n_turbines,)
    if uq:
        turb_lt_mean  = _safe_list(np.nanmean(wl.turbine_wake_losses_lt,  axis=0))
        turb_por_mean = _safe_list(np.nanmean(wl.turbine_wake_losses_por, axis=0))
        turb_lt_std   = _safe_list(np.nanstd(wl.turbine_wake_losses_lt,   axis=0))
        turb_por_std  = _safe_list(np.nanstd(wl.turbine_wake_losses_por,  axis=0))
    else:
        turb_lt_mean  = _safe_list(wl.turbine_wake_losses_lt)
        turb_por_mean = _safe_list(wl.turbine_wake_losses_por)
        turb_lt_std   = []
        turb_por_std  = []

    turbine_results = {
        "turbine_ids":                    list(wl.turbine_ids),
        "turbine_wake_losses_lt_mean":    turb_lt_mean,
        "turbine_wake_losses_por_mean":   turb_por_mean,
        "turbine_wake_losses_lt_std":     turb_lt_std,
        "turbine_wake_losses_por_std":    turb_por_std,
    }

    # ── 10. Generate plots via WakeLosses built-in methods ───────────
    #  WakeLosses exposes two plot methods:
    #    .plot_wake_losses_by_wind_direction(return_fig=True, …)
    #    .plot_wake_losses_by_wind_speed(return_fig=True, …)
    #  Both accept an optional turbine_id for turbine-level plots.
    #  We generate farm-level plots here.

    plots = {}

    # -- Plot 1: Wake losses by wind direction (farm level) -----------
    try:
        fig_dir = wl.plot_wake_losses_by_wind_direction(
            plot_norm_energy=True,
            return_fig=True,
            figure_kwargs={"figsize": (10, 6), "facecolor": "#0b1623"},
            plot_kwargs_line={"linewidth": 2.0},
            plot_kwargs_fill={"alpha": 0.25},
        )
        plots["wake_losses_by_direction"] = _fig_to_b64(fig_dir)
        logger.info("Generated wake-losses-by-direction plot.")
    except Exception as e:
        logger.warning(f"Direction plot failed: {e}")
        plots["wake_losses_by_direction"] = None

    # -- Plot 2: Wake losses by wind speed (farm level) ---------------
    try:
        fig_ws = wl.plot_wake_losses_by_wind_speed(
            plot_norm_energy=True,
            return_fig=True,
            figure_kwargs={"figsize": (10, 6), "facecolor": "#0b1623"},
            plot_kwargs_line={"linewidth": 2.0},
            plot_kwargs_fill={"alpha": 0.25},
        )
        plots["wake_losses_by_wind_speed"] = _fig_to_b64(fig_ws)
        logger.info("Generated wake-losses-by-wind-speed plot.")
    except Exception as e:
        logger.warning(f"Wind speed plot failed: {e}")
        plots["wake_losses_by_wind_speed"] = None

    # -- Plot 3-N: Per-turbine direction plots (one per turbine) ------
    turbine_direction_plots = {}
    for tid in wl.turbine_ids:
        try:
            fig_t = wl.plot_wake_losses_by_wind_direction(
                turbine_id=tid,
                plot_norm_energy=False,
                return_fig=True,
                figure_kwargs={"figsize": (8, 4), "facecolor": "#0b1623"},
                plot_kwargs_line={"linewidth": 1.8},
                plot_kwargs_fill={"alpha": 0.2},
            )
            turbine_direction_plots[tid] = _fig_to_b64(fig_t)
        except Exception as e:
            logger.warning(f"Turbine direction plot failed for {tid}: {e}")
            turbine_direction_plots[tid] = None

    plots["turbine_direction_plots"] = turbine_direction_plots

    # -- Plot: Per-turbine wind speed plots ---------------------------
    turbine_ws_plots = {}
    for tid in wl.turbine_ids:
        try:
            fig_tw = wl.plot_wake_losses_by_wind_speed(
                turbine_id=tid,
                plot_norm_energy=False,
                return_fig=True,
                figure_kwargs={"figsize": (8, 4), "facecolor": "#0b1623"},
                plot_kwargs_line={"linewidth": 1.8},
                plot_kwargs_fill={"alpha": 0.2},
            )
            turbine_ws_plots[tid] = _fig_to_b64(fig_tw)
        except Exception as e:
            logger.warning(f"Turbine WS plot failed for {tid}: {e}")
            turbine_ws_plots[tid] = None

    plots["turbine_ws_plots"] = turbine_ws_plots

    # ── 11. Assemble final response dict ─────────────────────────────
    result = {
        "status": "success",

        # ── Scalar summary ──────────────────────────────────────────
        "summary": summary,

        # ── Top-level convenience keys (used directly by WakeLoss.jsx) ─
        "wake_losses_lt_mean":     summary["wake_losses_lt_mean"],
        "wake_losses_lt_std":      summary["wake_losses_lt_std"],
        "wake_losses_por_mean":    summary["wake_losses_por_mean"],
        "wake_losses_por_std":     summary["wake_losses_por_std"],
        "farm_efficiency_lt_mean": summary["farm_efficiency_lt_mean"],

        # ── Turbine-level ────────────────────────────────────────────
        "turbine_ids":                   turbine_results["turbine_ids"],
        "turbine_wake_losses_lt_mean":   turbine_results["turbine_wake_losses_lt_mean"],
        "turbine_wake_losses_por_mean":  turbine_results["turbine_wake_losses_por_mean"],
        "turbine_wake_losses_lt_std":    turbine_results["turbine_wake_losses_lt_std"],
        "turbine_wake_losses_por_std":   turbine_results["turbine_wake_losses_por_std"],

        # ── Binned arrays (for recharts fallback in JSX) ─────────────
        "wake_losses_lt_wd":   _safe_list(wl_lt_wd),
        "wake_losses_por_wd":  _safe_list(wl_por_wd),
        "energy_lt_wd":        _safe_list(en_lt_wd),
        "energy_por_wd":       _safe_list(en_por_wd),

        "wake_losses_lt_ws":   _safe_list(wl_lt_ws),
        "wake_losses_por_ws":  _safe_list(wl_por_ws),
        "energy_lt_ws":        _safe_list(en_lt_ws),
        "energy_por_ws":       _safe_list(en_por_ws),

        # ── Base64 plots ─────────────────────────────────────────────
        "plots": plots,
    }

    logger.info("Wake loss analysis complete.")
    return result