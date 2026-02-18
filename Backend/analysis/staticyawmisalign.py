"""
analysis/yaw.py
──────────────────────────────────────────────────────────────────────────────
Standalone analysis function for Static Yaw Misalignment estimation using
the OpenOA StaticYawMisalignment class.

Called from app.py:
    from analysis.yaw import run_static_yaw_analysis
    result = run_static_yaw_analysis(plant, config)

Returns a dict ready to be serialised by FastAPI (JSON-safe):
  - summary numbers    (per-turbine avg yaw misalignment, std, 95% CI)
  - per-ws-bin numbers (yaw misalignment per turbine per wind speed bin)
  - base64 PNG plots   (one composite plot per turbine via built-in method)

──────────────────────────────────────────────────────────────────────────────
ATTRIBUTE REFERENCE  (from StaticYawMisalignment class source)
──────────────────────────────────────────────────────────────────────────────

Result arrays set after .run():

  UQ = True
  ─────────────────────────────────────────────────────────────────────────
  yaw_misalignment_ws      ndarray  shape (num_sim, n_turbines, n_ws_bins)
      Raw per-sim yaw misalignment for each turbine and ws bin.

  yaw_misalignment         ndarray  shape (num_sim, n_turbines)
      Per-sim yaw misalignment averaged over all ws bins per turbine.

  yaw_misalignment_avg     ndarray  shape (n_turbines,)
      Mean of yaw_misalignment over MC simulations.  ← primary summary value

  yaw_misalignment_std     ndarray  shape (n_turbines,)
      Std dev of yaw_misalignment over MC simulations.

  yaw_misalignment_95ci    ndarray  shape (n_turbines, 2)
      [2.5th, 97.5th] percentile of yaw_misalignment over MC simulations.
      axis-0 = turbine, axis-1 = [lower, upper].

  yaw_misalignment_avg_ws  ndarray  shape (n_turbines, n_ws_bins)
      Mean of yaw_misalignment_ws over MC simulations per ws bin.

  yaw_misalignment_std_ws  ndarray  shape (n_turbines, n_ws_bins)
      Std dev of yaw_misalignment_ws over MC simulations per ws bin.

  yaw_misalignment_95ci_ws ndarray  shape (n_turbines, n_ws_bins, 2)
      [2.5th, 97.5th] percentile per ws bin.
      axis-2 = [lower, upper].

  UQ = False
  ─────────────────────────────────────────────────────────────────────────
  yaw_misalignment_ws      ndarray  shape (n_turbines, n_ws_bins)
      Single yaw misalignment estimate per turbine per ws bin.

  yaw_misalignment         ndarray  shape (n_turbines,)
      Single yaw misalignment estimate averaged over all ws bins per turbine.

  NOTE: yaw_misalignment_avg / _std / _95ci / _avg_ws / _std_ws / _95ci_ws
        are NOT populated when UQ=False — do not access them.

Plot method (built-in):
  .plot_yaw_misalignment_by_turbine(
      turbine_ids=None,      # None = all turbines
      return_fig=True,
      figure_kwargs={...},
      plot_kwargs_curve={...},
      plot_kwargs_line={...},
      plot_kwargs_fill={...},   # only used when UQ=True
      legend_kwargs={...},
  )
  Returns dict {turbine_id: (fig, axes)} when return_fig=True.
──────────────────────────────────────────────────────────────────────────────
"""

import io
import base64
import logging
from typing import Optional

import numpy as np

import matplotlib
matplotlib.use("Agg")          # non-interactive backend — must be before pyplot
import matplotlib.pyplot as plt

from openoa.plant import PlantData
from openoa.analysis.static_yaw_misalignment import StaticYawMisalignment

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# INTERNAL HELPERS
# ─────────────────────────────────────────────────────────────────────────────

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
    Mirrors StaticYawMisalignment attrs field semantics exactly:
      max_power_filter     : float | tuple[float, float]
      power_bin_mad_thresh : float | tuple[float, float]
    """
    if use_uq:
        return (float(min_val), float(max_val))
    return float(min_val)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ANALYSIS FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def run_static_yaw_analysis(
    plant: PlantData,
    config,         # StaticYawConfig pydantic model from app.py
) -> dict:
    """
    Build a StaticYawMisalignment object from ``plant`` and ``config``,
    run the analysis, generate per-turbine plots, and return a
    JSON-serialisable result dict.

    Parameters
    ----------
    plant : PlantData
        Validated PlantData object from the session store.
    config : StaticYawConfig
        Pydantic model populated from the staticyaw.jsx frontend payload.
        Expected fields — mirrors DEFAULT_PARAMS in staticyaw.jsx exactly:

            turbine_ids                 : list[str] | None
            UQ                          : bool
            num_sim                     : int
            ws_bins                     : list[float]
            ws_bin_width                : float
            vane_bin_width              : float
            min_vane_bin_count          : int
            max_abs_vane_angle          : float
            pitch_thresh                : float
            num_power_bins              : int
            min_power_filter            : float
            max_power_filter_min        : float   (UQ lower bound)
            max_power_filter_max        : float   (UQ upper bound)
            max_power_filter_single     : float   (non-UQ single value)
            power_bin_mad_thresh_min    : float   (UQ lower bound)
            power_bin_mad_thresh_max    : float   (UQ upper bound)
            power_bin_mad_thresh_single : float   (non-UQ single value)
            use_power_coeff             : bool

    Returns
    -------
    dict with keys:
        status, summary, turbine_results, plots
    """

    uq: bool = config.UQ

    # ── 1. Resolve tuple-or-single parameters ────────────────────────────────
    #
    # StaticYawMisalignment class defines these two attrs fields as:
    #   max_power_filter     : float | tuple[float, float]
    #   power_bin_mad_thresh : float | tuple[float, float]
    #
    # The frontend sends separate _min / _max / _single fields so we can
    # present the right UI in each mode and reconstruct correctly here.
    #
    # UQ=True  → pass the tuple; _setup_monte_carlo_inputs() does:
    #               np.random.randint(lo*100, hi*100+1, num_sim) / 100.0
    #               np.random.randint(lo, hi+1, num_sim)
    # UQ=False → pass the single float; used directly, no sampling.

    if uq:
        max_power_filter = _parse_tuple_or_single(
            config.max_power_filter_min,
            config.max_power_filter_max,
            use_uq=True,
        )
        power_bin_mad_thresh = _parse_tuple_or_single(
            config.power_bin_mad_thresh_min,
            config.power_bin_mad_thresh_max,
            use_uq=True,
        )
    else:
        max_power_filter     = float(config.max_power_filter_single)
        power_bin_mad_thresh = float(config.power_bin_mad_thresh_single)

    # ── 2. Build StaticYawMisalignment attrs object ───────────────────────────
    logger.info("Building StaticYawMisalignment object …")

    sym = StaticYawMisalignment(
        plant=plant,
        turbine_ids=config.turbine_ids or None,    # None → analyze all turbines
        UQ=uq,
        num_sim=int(config.num_sim) if uq else 1,  # num_sim ignored when UQ=False
        ws_bins=list(config.ws_bins),
        ws_bin_width=float(config.ws_bin_width),
        vane_bin_width=float(config.vane_bin_width),
        min_vane_bin_count=int(config.min_vane_bin_count),
        max_abs_vane_angle=float(config.max_abs_vane_angle),
        pitch_thresh=float(config.pitch_thresh),
        num_power_bins=int(config.num_power_bins),
        min_power_filter=float(config.min_power_filter),
        max_power_filter=max_power_filter,
        power_bin_mad_thresh=power_bin_mad_thresh,
        use_power_coeff=bool(config.use_power_coeff),
    )

    # ── 3. Run the analysis ───────────────────────────────────────────────────
    logger.info("Running StaticYawMisalignment.run() …")
    sym.run()

    # ── 4. Extract scalar summary results ────────────────────────────────────
    #
    # Attribute access differs strictly between UQ and non-UQ modes.
    #
    # UQ=True  — these are set inside run() after the MC loop:
    #   yaw_misalignment_avg     shape (n_turbines,)        mean over num_sim
    #   yaw_misalignment_std     shape (n_turbines,)        std  over num_sim
    #   yaw_misalignment_95ci    shape (n_turbines, 2)      [2.5, 97.5] percentile
    #
    # UQ=False — ONLY these are valid after run():
    #   yaw_misalignment         shape (n_turbines,)        single estimate, avg over ws bins
    #
    # In both modes:
    #   turbine_ids is the canonical ordered list of turbine IDs used.

    turbine_ids: list[str] = list(sym.turbine_ids)
    n_turbines = len(turbine_ids)

    if uq:
        # shape (n_turbines,)
        yaw_avg = _safe_list(sym.yaw_misalignment_avg)
        yaw_std = _safe_list(sym.yaw_misalignment_std)
        # shape (n_turbines, 2) — axis-1: [lower_95ci, upper_95ci]
        yaw_ci_low  = _safe_list(sym.yaw_misalignment_95ci[:, 0])
        yaw_ci_high = _safe_list(sym.yaw_misalignment_95ci[:, 1])

        summary = {
            "UQ":       True,
            "num_sim":  int(config.num_sim),
            "turbine_ids":          turbine_ids,
            "yaw_misalignment_avg": yaw_avg,       # mean over MC
            "yaw_misalignment_std": yaw_std,       # std  over MC
            "yaw_misalignment_ci_low":  yaw_ci_low,   # 2.5th percentile
            "yaw_misalignment_ci_high": yaw_ci_high,  # 97.5th percentile
        }

    else:
        # shape (n_turbines,) — single estimate averaged over ws bins
        yaw_single = _safe_list(sym.yaw_misalignment)

        summary = {
            "UQ":       False,
            "num_sim":  1,
            "turbine_ids":              turbine_ids,
            "yaw_misalignment_avg":     yaw_single,
            "yaw_misalignment_std":     [],
            "yaw_misalignment_ci_low":  [],
            "yaw_misalignment_ci_high": [],
        }

    # ── 5. Per-wind-speed-bin results ─────────────────────────────────────────
    #
    # UQ=True:
    #   yaw_misalignment_avg_ws   shape (n_turbines, n_ws_bins)  mean over MC
    #   yaw_misalignment_std_ws   shape (n_turbines, n_ws_bins)  std  over MC
    #   yaw_misalignment_95ci_ws  shape (n_turbines, n_ws_bins, 2)
    #                               axis-2: [lower_95ci, upper_95ci]
    #
    # UQ=False:
    #   yaw_misalignment_ws       shape (n_turbines, n_ws_bins)  single estimate

    ws_bins: list[float] = list(sym.ws_bins)

    turbine_results = []

    for idx, tid in enumerate(turbine_ids):

        if uq:
            # (n_ws_bins,) vectors for this turbine
            ws_avg  = _safe_list(sym.yaw_misalignment_avg_ws[idx, :])
            ws_std  = _safe_list(sym.yaw_misalignment_std_ws[idx, :])
            ws_ci_low  = _safe_list(sym.yaw_misalignment_95ci_ws[idx, :, 0])
            ws_ci_high = _safe_list(sym.yaw_misalignment_95ci_ws[idx, :, 1])

            per_ws_bin = [
                {
                    "ws_bin":            ws,
                    "yaw_misalignment":  ws_avg[k],
                    "yaw_misalignment_std":   ws_std[k],
                    "yaw_misalignment_ci_low":  ws_ci_low[k],
                    "yaw_misalignment_ci_high": ws_ci_high[k],
                }
                for k, ws in enumerate(ws_bins)
            ]

            turbine_results.append({
                "turbine_id":               tid,
                "yaw_misalignment_avg":     summary["yaw_misalignment_avg"][idx],
                "yaw_misalignment_std":     summary["yaw_misalignment_std"][idx],
                "yaw_misalignment_ci_low":  summary["yaw_misalignment_ci_low"][idx],
                "yaw_misalignment_ci_high": summary["yaw_misalignment_ci_high"][idx],
                "ws_bins": per_ws_bin,
            })

        else:
            # (n_ws_bins,) single estimate for this turbine
            ws_single = _safe_list(sym.yaw_misalignment_ws[idx, :])

            per_ws_bin = [
                {
                    "ws_bin":           ws,
                    "yaw_misalignment": ws_single[k],
                    "yaw_misalignment_std":   None,
                    "yaw_misalignment_ci_low":  None,
                    "yaw_misalignment_ci_high": None,
                }
                for k, ws in enumerate(ws_bins)
            ]

            turbine_results.append({
                "turbine_id":               tid,
                "yaw_misalignment_avg":     summary["yaw_misalignment_avg"][idx],
                "yaw_misalignment_std":     None,
                "yaw_misalignment_ci_low":  None,
                "yaw_misalignment_ci_high": None,
                "ws_bins": per_ws_bin,
            })

    # ── 6. Generate plots via built-in plot method ────────────────────────────
    #
    # StaticYawMisalignment exposes one plot method:
    #   .plot_yaw_misalignment_by_turbine(
    #       turbine_ids=None,       # None → all turbines
    #       return_fig=True,
    #       figure_kwargs={},
    #       plot_kwargs_curve={},   # cosine fit line kwargs → ax.plot()
    #       plot_kwargs_line={},    # vane angle vlines kwargs → ax.plot()
    #       plot_kwargs_fill={},    # UQ CI shading kwargs → ax.fill_between()
    #       legend_kwargs={},
    #   )
    #   Returns dict {turbine_id: (fig, axes)} when return_fig=True.
    #
    # We call it once per turbine so each plot is independently stored.

    plots = {}

    for tid in turbine_ids:
        try:
            axes_dict = sym.plot_yaw_misalignment_by_turbine(
                turbine_ids=[tid],
                return_fig=True,
                figure_kwargs={"figsize": (14, 5), "facecolor": "#070f14"},
                plot_kwargs_curve={"linewidth": 2.0},
                plot_kwargs_line={"linewidth": 1.4},
                plot_kwargs_fill={"alpha": 0.2},        # only applied when UQ=True
                legend_kwargs={"fontsize": 8},
            )
            # axes_dict is {turbine_id: (fig, axes)}
            fig, _ = axes_dict[tid]
            plots[tid] = _fig_to_b64(fig)
            logger.info(f"Generated yaw misalignment plot for turbine {tid}.")

        except Exception as e:
            logger.warning(f"Plot failed for turbine {tid}: {e}")
            plots[tid] = None

    # ── 7. Assemble final response dict ───────────────────────────────────────
    result = {
        "status": "success",

        # ── Mode flags ────────────────────────────────────────────────────────
        "UQ":             uq,
        "num_sim":        int(config.num_sim) if uq else 1,
        "use_power_coeff": bool(config.use_power_coeff),
        "ws_bins":        ws_bins,

        # ── Scalar summary ────────────────────────────────────────────────────
        # Top-level convenience keys — used directly by staticyaw.jsx ResultsPhase
        "turbine_ids":              turbine_ids,
        "yaw_misalignment_avg":     summary["yaw_misalignment_avg"],     # list[float|None]
        "yaw_misalignment_std":     summary["yaw_misalignment_std"],     # list[float|None]
        "yaw_misalignment_ci_low":  summary["yaw_misalignment_ci_low"],  # list[float|None]
        "yaw_misalignment_ci_high": summary["yaw_misalignment_ci_high"], # list[float|None]

        # ── Full nested per-turbine results (for table view in JSX) ──────────
        # Shape mirrors the TurbineResult Pydantic model in the previous API file:
        #   turbine_results[i].turbine_id        str
        #   turbine_results[i].yaw_misalignment_avg     float|None
        #   turbine_results[i].yaw_misalignment_std     float|None
        #   turbine_results[i].yaw_misalignment_ci_low  float|None
        #   turbine_results[i].yaw_misalignment_ci_high float|None
        #   turbine_results[i].ws_bins           list of per-ws-bin dicts
        "turbine_results": turbine_results,

        # ── Base64 plots — one entry per turbine ──────────────────────────────
        # plots[turbine_id] = base64 PNG string | None
        "plots": plots,
    }

    logger.info("Static yaw misalignment analysis complete.")
    return result