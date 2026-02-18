"""
eya_gap.py
----------
FastAPI router for EYA Gap Analysis.

Strictly uses OpenOA library classes and methods:
    - EYAEstimate       : attrs dataclass for EYA consultant inputs
    - OAResults         : attrs dataclass for operational assessment results
    - EYAGapAnalysis    : main analysis class
        .run()          : executes compile_data(), stores result in .compiled_data
        .compile_data() : returns [EYA_AEP, TIE_diff, avail_diff, elec_diff, unexplained]
    - create_EYAGapAnalysis() : OpenOA factory function (used as the entry point)

Mount onto main app.py with:
    from eya_gap import router as eya_gap_router
    app.include_router(eya_gap_router)
"""

from __future__ import annotations

from typing import Annotated
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from openoa import PlantData
# ── Import ONLY from OpenOA source ────────────────────────────────
from openoa.analysis.eya_gap_analysis import (
    EYAGapAnalysis,           # main analysis class
    EYAEstimate,              # attrs dataclass for EYA inputs
    OAResults,                # attrs dataclass for OA results
    create_EYAGapAnalysis,    # OpenOA factory function
)


router = APIRouter(tags=["EYA Gap Analysis"])


# ─────────────────────────────────────────────────────────────────
# PYDANTIC INPUT MODELS
# Pydantic handles HTTP-layer validation (types, ranges, required).
# OpenOA attrs validators run a second pass when constructing
# EYAEstimate / OAResults — matching validate_half_closed_0_1_left.
# ─────────────────────────────────────────────────────────────────

class EYAEstimateInput(BaseModel):
    """
    EYA consultant estimates — maps 1:1 to OpenOA EYAEstimate fields.
    Loss fields validated [0, 1) matching OpenOA's
    validate_half_closed_0_1_left validator on EYAEstimate.
    """

    aep: Annotated[float, Field(
        gt=0,
        description="EYA predicted AEP (GWh/yr)",
        examples=[12.4],
    )]
    gross_energy: Annotated[float, Field(
        gt=0,
        description="EYA predicted gross energy (GWh/yr)",
        examples=[15.2],
    )]
    availability_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="EYA availability losses [0, 1)",
        examples=[0.032],
    )]
    electrical_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="EYA electrical losses [0, 1)",
        examples=[0.015],
    )]
    turbine_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="EYA turbine losses [0, 1)",
        examples=[0.04],
    )]
    blade_degradation_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="EYA blade degradation losses [0, 1)",
        examples=[0.01],
    )]
    wake_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="EYA wake losses [0, 1)",
        examples=[0.08],
    )]

    @model_validator(mode="after")
    def check_total_losses_lt_1(self) -> "EYAEstimateInput":
        """
        Sum of all loss fractions must be < 1.0 — physically impossible otherwise.
        OpenOA does not enforce this cross-field check, so we add it here.
        """
        total = (
            self.availability_losses
            + self.electrical_losses
            + self.turbine_losses
            + self.blade_degradation_losses
            + self.wake_losses
        )
        if total >= 1.0:
            raise ValueError(
                f"Sum of all EYA loss fractions ({total:.4f}) must be < 1.0."
            )
        return self


class OAResultsInput(BaseModel):
    """
    Operational Assessment results — maps 1:1 to OpenOA OAResults fields.
    Loss fields validated [0, 1) matching OpenOA's validate_0_1 validator
    on OAResults.availability_losses and OAResults.electrical_losses.
    """

    aep: Annotated[float, Field(
        gt=0,
        description="OA measured AEP (GWh/yr)",
        examples=[11.1],
    )]
    availability_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="OA availability losses [0, 1)",
        examples=[0.041],
    )]
    electrical_losses: Annotated[float, Field(
        ge=0.0, lt=1.0,
        description="OA electrical losses [0, 1)",
        examples=[0.018],
    )]
    turbine_ideal_energy: Annotated[float, Field(
        gt=0,
        description="OA turbine ideal energy — energy during normal operation (GWh/yr)",
        examples=[13.6],
    )]


class GapAnalysisRequest(BaseModel):
    """Full request body."""
    eya_estimates: EYAEstimateInput
    oa_results:    OAResultsInput


# ─────────────────────────────────────────────────────────────────
# ENDPOINT
# ─────────────────────────────────────────────────────────────────


def run_eya_gap_analysis(plant: PlantData, body: GapAnalysisRequest):
    """
    Pipeline (strictly using OpenOA library):

    1. Construct `EYAEstimate` attrs dataclass  ← OpenOA class
    2. Construct `OAResults` attrs dataclass     ← OpenOA class
    3. Call `create_EYAGapAnalysis()`            ← OpenOA factory function
       which returns `EYAGapAnalysis(plant, eya_estimates, oa_results)`
    4. Call `.run()` on the analysis object      ← OpenOA method
       internally calls `.compile_data()`        ← OpenOA method
    5. Read `.compiled_data` from the object     ← OpenOA attribute
    6. Read `.eya_estimates` and `.oa_results`   ← OpenOA attrs objects
       to extract derived values without manual recalculation

    Returns
    -------
    compiled_data          : list[float] — [EYA_AEP, TIE_diff, avail_diff, elec_diff, unexplained]
                             directly from EYAGapAnalysis.compiled_data (set by .run())
    waterfall_labels       : list[str]  — x-axis labels matching compiled_data order
    eya_aep                : float      — from EYAEstimate.aep
    oa_aep                 : float      — from OAResults.aep
    gap_gwh                : float      — OA AEP − EYA AEP
    gap_pct                : float      — gap as % of EYA AEP
    eya_turbine_ideal_energy: float     — derived from compiled_data[0] + compiled_data[1]
                              (EYA AEP + TIE diff = OA TIE, so EYA TIE = OA TIE - TIE_diff)
                              read from OpenOA-computed compiled_data, NOT recalculated
    avail_diff_gwh         : float      — compiled_data[2], from OpenOA
    elec_diff_gwh          : float      — compiled_data[3], from OpenOA
    unexplained_gwh        : float      — compiled_data[4], from OpenOA
    eya_estimates          : dict       — echo of EYAEstimate attrs fields
    oa_results             : dict       — echo of OAResults attrs fields
    """

    # ── Step 1 & 2: Construct OpenOA attrs dataclasses ────────────
    # EYAEstimate and OAResults are @define (attrs) classes.
    # Their own validators (validate_half_closed_0_1_left, validate_0_1)
    # run automatically during construction.
    try:
        eya_estimate_obj = EYAEstimate(
            aep                      = body.eya_estimates.aep,
            gross_energy             = body.eya_estimates.gross_energy,
            availability_losses      = body.eya_estimates.availability_losses,
            electrical_losses        = body.eya_estimates.electrical_losses,
            turbine_losses           = body.eya_estimates.turbine_losses,
            blade_degradation_losses = body.eya_estimates.blade_degradation_losses,
            wake_losses              = body.eya_estimates.wake_losses,
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"EYAEstimate construction failed (OpenOA validator): {str(e)}",
        )

    try:
        oa_results_obj = OAResults(
            aep                  = body.oa_results.aep,
            availability_losses  = body.oa_results.availability_losses,
            electrical_losses    = body.oa_results.electrical_losses,
            turbine_ideal_energy = body.oa_results.turbine_ideal_energy,
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"OAResults construction failed (OpenOA validator): {str(e)}",
        )

    # ── Step 3: Use OpenOA factory function create_EYAGapAnalysis() ─
    # From source: create_EYAGapAnalysis(project, eya_estimates, oa_results)
    # plant=None is explicitly supported in EYAGapAnalysis.__attrs_post_init__
    try:
        analysis: EYAGapAnalysis = create_EYAGapAnalysis(
            project       = None,
            eya_estimates = eya_estimate_obj,
            oa_results    = oa_results_obj,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"create_EYAGapAnalysis() failed: {str(e)}",
        )

    # ── Step 4: Call .run() — OpenOA method ──────────────────────
    # .run() internally calls self.compile_data() and stores the
    # result in self.compiled_data (list of 5 floats)
    try:
        analysis.run()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"EYAGapAnalysis.run() failed: {str(e)}",
        )

    # ── Step 5: Read .compiled_data — set by OpenOA .run() ────────
    # compiled_data structure (from OpenOA source compile_data()):
    #   [0] = eya_estimates.aep                (EYA AEP baseline)
    #   [1] = oa_results.turbine_ideal_energy - eya_turbine_ideal_energy  (TIE diff)
    #   [2] = (eya_avail_losses - oa_avail_losses) * eya_turbine_ideal    (avail diff)
    #   [3] = (eya_elec_losses  - oa_elec_losses)  * eya_turbine_ideal    (elec diff)
    #   [4] = unexplained residual
    compiled: list = analysis.compiled_data

    # ── Step 6: Derive summary values from OpenOA attrs objects ───
    # Read directly from the OpenOA-built EYAEstimate and OAResults
    # objects — never recalculate manually.

    eya_aep  = analysis.eya_estimates.aep          # EYAEstimate.aep
    oa_aep   = analysis.oa_results.aep             # OAResults.aep

    gap_gwh  = oa_aep - eya_aep
    gap_pct  = (gap_gwh / eya_aep) * 100 if eya_aep else 0.0

    # EYA Turbine Ideal Energy is not stored as a public attribute on
    # EYAEstimate. It is computed inside compile_data() as a local variable.
    # We recover it from compiled_data:
    #   compiled[1] = oa_turbine_ideal_energy - eya_turbine_ideal_energy
    #   => eya_turbine_ideal_energy = oa_turbine_ideal_energy - compiled[1]
    eya_turbine_ideal_energy = (
        analysis.oa_results.turbine_ideal_energy - compiled[1]
    )

    # ── Build response ────────────────────────────────────────────
    return {
        # ── Core OpenOA output ──────────────────────────────────────
        # compiled_data comes directly from EYAGapAnalysis.compiled_data
        # set by .run() → .compile_data()
        "compiled_data": [round(float(v), 6) for v in compiled],

        # Waterfall x-axis labels — matching compiled_data order exactly
        # as documented in EYAGapAnalysis.plot_waterfall() default index
        "waterfall_labels": [
            "EYA AEP",           # compiled[0]
            "TIE",               # compiled[1]
            "Availability\nLosses",  # compiled[2]
            "Electrical\nLosses",    # compiled[3]
            "Unexplained",       # compiled[4]
            "OA AEP",            # running total
        ],

        # ── Derived from OpenOA attrs objects ───────────────────────
        "eya_aep":                    round(eya_aep,                    4),
        "oa_aep":                     round(oa_aep,                     4),
        "gap_gwh":                    round(gap_gwh,                    4),
        "gap_pct":                    round(gap_pct,                    4),
        "eya_turbine_ideal_energy":   round(eya_turbine_ideal_energy,   4),

        # ── Individual compiled_data elements named for frontend ────
        # All sourced from analysis.compiled_data (OpenOA output)
        "avail_diff_gwh":    round(float(compiled[2]), 4),
        "elec_diff_gwh":     round(float(compiled[3]), 4),
        "unexplained_gwh":   round(float(compiled[4]), 4),

        # ── Echo OpenOA attrs object fields back to frontend ────────
        # Reading from analysis.eya_estimates and analysis.oa_results
        # (the OpenOA attrs objects), not from the raw Pydantic input
        "eya_estimates": {
            "aep":                     analysis.eya_estimates.aep,
            "gross_energy":            analysis.eya_estimates.gross_energy,
            "availability_losses":     analysis.eya_estimates.availability_losses,
            "electrical_losses":       analysis.eya_estimates.electrical_losses,
            "turbine_losses":          analysis.eya_estimates.turbine_losses,
            "blade_degradation_losses":analysis.eya_estimates.blade_degradation_losses,
            "wake_losses":             analysis.eya_estimates.wake_losses,
        },
        "oa_results": {
            "aep":                  analysis.oa_results.aep,
            "availability_losses":  analysis.oa_results.availability_losses,
            "electrical_losses":    analysis.oa_results.electrical_losses,
            "turbine_ideal_energy": analysis.oa_results.turbine_ideal_energy,
        },
    }