import { useState, useEffect, useRef } from "react";
import styles from "./staticyaw.module.css";
import axios from 'axios'
const API_URL = "http://localhost:8000/static-yaw";

// ─── PHASE constants ──────────────────────────────────────────────────────────
const PHASE = { FORM: "form", LOADING: "loading", RESULTS: "results", ERROR: "error" };

// ─── Loading messages cycling during analysis ─────────────────────────────────
const LOADING_STEPS = [
  "Validating plant data...",
  "Applying pitch threshold filter...",
  "Removing power curve outliers...",
  "Dividing data into wind speed bins...",
  "Binning power performance by vane angle...",
  "Fitting cosine curves to vane bins...",
  "Running Monte Carlo simulations...",
  "Computing 95% confidence intervals...",
  "Building result plots...",
  "Finalising yaw misalignment estimates...",
];

const DEFAULT_PARAMS = {
  turbine_ids: "",
  UQ: true,
  num_sim: 100,
  ws_bins: "5.0, 6.0, 7.0, 8.0",
  ws_bin_width: 1.0,
  vane_bin_width: 1.0,
  min_vane_bin_count: 100,
  max_abs_vane_angle: 25.0,
  pitch_thresh: 0.5,
  num_power_bins: 25,
  min_power_filter: 0.01,
  max_power_filter_single: 0.95,
  max_power_filter_min: 0.92,
  max_power_filter_max: 0.98,
  power_bin_mad_thresh_single: 7.0,
  power_bin_mad_thresh_min: 4.0,
  power_bin_mad_thresh_max: 10.0,
  use_power_coeff: false,
};

// ─── Small shared components ──────────────────────────────────────────────────

const InfoIcon = ({ tooltip }) => (
  <span className={styles.infoIcon} data-tooltip={tooltip}>?</span>
);

const Toggle = ({ checked, onChange, id }) => (
  <label className={styles.toggle} htmlFor={id}>
    <input type="checkbox" id={id} checked={checked} onChange={onChange} />
    <span className={styles.toggleSlider} />
    <span className={styles.toggleLabel}>{checked ? "Enabled" : "Disabled"}</span>
  </label>
);

function Section({ title, tag, open, onToggle, children }) {
  return (
    <div className={styles.section}>
      <button className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionLeft}>
          <span className={styles.sectionIcon}>⚙</span>
          <span className={styles.sectionTitle}>{title}</span>
          {tag && <span className={styles.sectionTag}>{tag}</span>}
        </div>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>‹</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

function Field({ label, hint, tooltip, span, children }) {
  return (
    <div className={`${styles.field} ${span === 2 ? styles.fieldSpan2 : ""}`}>
      <div className={styles.fieldLabel}>
        <span className={styles.fieldLabelText}>{label}</span>
        <span className={styles.fieldHint}>{hint}</span>
        {tooltip && <InfoIcon tooltip={tooltip} />}
      </div>
      {children}
    </div>
  );
}

// ─── LOADING PHASE ────────────────────────────────────────────────────────────

function LoadingPhase({ uq, numSim }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dots, setDots] = useState("");

  useEffect(() => {
    // Cycle loading step text
    const stepInterval = setInterval(() => {
      setStepIdx((i) => (i + 1) % LOADING_STEPS.length);
    }, 1800);

    // Smooth progress bar (never reaches 100 — backend completion handles that)
    const progInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        const increment = p < 40 ? 1.8 : p < 70 ? 0.9 : 0.3;
        return Math.min(p + increment, 92);
      });
    }, 120);

    // Animated ellipsis
    const dotsInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 400);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progInterval);
      clearInterval(dotsInterval);
    };
  }, []);

  return (
    <div className={styles.loadingPage}>
      {/* Rotating turbine SVG */}
      <div className={styles.turbineWrap}>
        <svg className={styles.turbineSvg} viewBox="0 0 120 120" fill="none">
          {/* Hub */}
          <circle cx="60" cy="60" r="7" fill="var(--accent)" opacity="0.9" />
          {/* Blades */}
          <g className={styles.turbineBlades}>
            <path d="M60 53 C57 30, 48 10, 52 4 C56 -2, 65 8, 63 30 Z"
              fill="var(--accent)" opacity="0.85" />
            <path d="M67 63 C88 68, 108 74, 112 70 C116 66, 106 57, 85 57 Z"
              fill="var(--accent)" opacity="0.85" />
            <path d="M53 67 C32 72, 12 78, 8 82 C4 86, 14 95, 35 87 Z"
              fill="var(--accent)" opacity="0.85" />
          </g>
          {/* Outer ring */}
          <circle cx="60" cy="60" r="52" stroke="var(--accent)" strokeWidth="1"
            strokeDasharray="6 4" opacity="0.25" className={styles.turbineRing} />
        </svg>

        {/* Glowing pulse rings */}
        <div className={styles.pulseRing} style={{ animationDelay: "0s" }} />
        <div className={styles.pulseRing} style={{ animationDelay: "0.6s" }} />
        <div className={styles.pulseRing} style={{ animationDelay: "1.2s" }} />
      </div>

      <div className={styles.loadingContent}>
        <div className={styles.loadingBadge}>
          <span className={styles.loadingDot} />
          ANALYSIS RUNNING
        </div>

        <h2 className={styles.loadingTitle}>
          Computing Yaw Misalignment{dots}
        </h2>

        {uq && (
          <p className={styles.loadingMeta}>
            Monte Carlo · <span className={styles.loadingAccent}>{numSim} simulations</span>
          </p>
        )}

        {/* Progress bar */}
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          <div className={styles.progressGlow} style={{ left: `${progress}%` }} />
        </div>
        <div className={styles.progressPct}>{Math.round(progress)}%</div>

        {/* Step text */}
        <p className={styles.loadingStep}>{LOADING_STEPS[stepIdx]}</p>

        {/* Step dots */}
        <div className={styles.stepDots}>
          {LOADING_STEPS.map((_, idx) => (
            <span
              key={idx}
              className={`${styles.stepDot} ${idx === stepIdx ? styles.stepDotActive : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── RESULTS PHASE ────────────────────────────────────────────────────────────

function ResultsPhase({ data, onBack }) {
  const [activeTurbine, setActiveTurbine] = useState(0);
  const [activeTab, setActiveTab] = useState("plot"); // "plot" | "table"
  const plotRef = useRef(null);

  const turbine   = data.results[activeTurbine];
  // plots is {turbine_id: base64_string} from yaw.py
  const plotB64   = data.plots[turbine?.turbine_id] ?? null;

  const ciColor = (val) => {
    const abs = Math.abs(val);
    if (abs < 2) return "var(--accent)";
    if (abs < 5) return "#f5a623";
    return "#e8453c";
  };

  return (
    <div className={styles.resultsPage}>
      {/* Results header */}
      <div className={styles.resultsHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          ← Back to Parameters
        </button>
        <div className={styles.resultsHeaderCenter}>
          <span className={styles.resultsBadge}>
            <span className={styles.resultsLiveDot} />
            ANALYSIS COMPLETE
          </span>
          <h2 className={styles.resultsTitle}>Static Yaw Misalignment Results</h2>
          <div className={styles.resultsMeta}>
            <span>{data.turbine_ids.length} turbine{data.turbine_ids.length !== 1 ? "s" : ""}</span>
            <span className={styles.metaSep}>·</span>
            <span>{data.ws_bins.join(", ")} m/s bins</span>
            {data.UQ && (
              <>
                <span className={styles.metaSep}>·</span>
                <span className={styles.metaAccent}>UQ enabled</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.resultsHeaderRight} />
      </div>

      {/* Summary cards — one per turbine */}
      <div className={styles.summaryStrip}>
        {data.results.map((r, idx) => (
          <button
            key={r.turbine_id}
            className={`${styles.summaryCard} ${idx === activeTurbine ? styles.summaryCardActive : ""}`}
            onClick={() => setActiveTurbine(idx)}
          >
            <span className={styles.summaryCardId}>{r.turbine_id}</span>
            <span
              className={styles.summaryCardVal}
              style={{ color: ciColor(r.yaw_misalignment_avg) }}
            >
              {r.yaw_misalignment_avg > 0 ? "+" : ""}
              {r.yaw_misalignment_avg.toFixed(2)}°
            </span>
            {data.UQ && r.yaw_misalignment_ci_low != null && (
              <span className={styles.summaryCardCi}>
                [{r.yaw_misalignment_ci_low.toFixed(1)}, {r.yaw_misalignment_ci_high.toFixed(1)}]
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Main content: Plot + Table tabs */}
      <div className={styles.resultsMain}>
        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === "plot" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("plot")}
          >
            ◈ Plot View
          </button>
          <button
            className={`${styles.tab} ${activeTab === "table" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("table")}
          >
            ▤ Data Table
          </button>
        </div>

        {/* Plot view — plotB64 is a raw base64 string from yaw.py */}
        {activeTab === "plot" && plotB64 && (
          <div className={styles.plotWrap} ref={plotRef}>
            <img
              src={`data:image/png;base64,${plotB64}`}
              alt={`Yaw misalignment plot for ${turbine.turbine_id}`}
              className={styles.plotImg}
            />
          </div>
        )}

        {/* Table view */}
        {activeTab === "table" && (
          <div className={styles.tableWrap}>
            {/* Overall summary row */}
            <div className={styles.overallRow}>
              <div className={styles.overallLabel}>Overall Average · {turbine.turbine_id}</div>
              <div
                className={styles.overallVal}
                style={{ color: ciColor(turbine.yaw_misalignment_avg) }}
              >
                {turbine.yaw_misalignment_avg > 0 ? "+" : ""}
                {turbine.yaw_misalignment_avg.toFixed(3)}°
              </div>
              {data.UQ && turbine.yaw_misalignment_std != null && (
                <div className={styles.overallSub}>
                  σ = {turbine.yaw_misalignment_std.toFixed(3)}°
                  &nbsp;|&nbsp;
                  95% CI [{turbine.yaw_misalignment_ci_low?.toFixed(2)}, {turbine.yaw_misalignment_ci_high?.toFixed(2)}]
                </div>
              )}
            </div>

            {/* Per-ws-bin table */}
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Wind Speed Bin</th>
                  <th>Yaw Misalignment</th>
                  {data.UQ && <th>Std Dev</th>}
                  {data.UQ && <th>95% CI</th>}
                  <th>Severity</th>
                </tr>
              </thead>
              <tbody>
                {turbine.ws_bins.map((row) => {
                  const abs = Math.abs(row.yaw_misalignment);
                  const severity = abs < 2 ? "Low" : abs < 5 ? "Moderate" : "High";
                  const sevClass = abs < 2 ? styles.sevLow : abs < 5 ? styles.sevMod : styles.sevHigh;
                  return (
                    <tr key={row.ws_bin} className={styles.dataRow}>
                      <td className={styles.wsBinCell}>{row.ws_bin} m/s</td>
                      <td
                        className={styles.valCell}
                        style={{ color: ciColor(row.yaw_misalignment) }}
                      >
                        {row.yaw_misalignment > 0 ? "+" : ""}
                        {row.yaw_misalignment.toFixed(3)}°
                      </td>
                      {data.UQ && (
                        <td className={styles.stdCell}>
                          {row.yaw_misalignment_std != null
                            ? `±${row.yaw_misalignment_std.toFixed(3)}°`
                            : "—"}
                        </td>
                      )}
                      {data.UQ && (
                        <td className={styles.ciCell}>
                          {row.yaw_misalignment_ci_low != null
                            ? `[${row.yaw_misalignment_ci_low.toFixed(2)}, ${row.yaw_misalignment_ci_high.toFixed(2)}]`
                            : "—"}
                        </td>
                      )}
                      <td><span className={`${styles.sevBadge} ${sevClass}`}>{severity}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ERROR PHASE ──────────────────────────────────────────────────────────────

function ErrorPhase({ error, onBack }) {
  return (
    <div className={styles.errorPage}>
      <div className={styles.errorIcon}>✕</div>
      <h2 className={styles.errorTitle}>Analysis Failed</h2>
      <p className={styles.errorSub}>The backend returned an error. Check logs for details.</p>
      <pre className={styles.errorTrace}>{error}</pre>
      <button className={styles.backBtn} onClick={onBack}>← Back to Parameters</button>
    </div>
  );
}

// ─── FORM PHASE ───────────────────────────────────────────────────────────────

function FormPhase({ onSubmit }) {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [expanded, setExpanded] = useState({ core: true, binning: true, filtering: false });

  const set = (key, value) => setParams((p) => ({ ...p, [key]: value }));
  const toggleSection = (key) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const buildPayload = () => {
    const turbine_ids =
      params.turbine_ids.trim() === ""
        ? null
        : params.turbine_ids.split(",").map((s) => s.trim()).filter(Boolean);

    const ws_bins = params.ws_bins
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => !isNaN(n));

    const max_power_filter = params.UQ
      ? [parseFloat(params.max_power_filter_min), parseFloat(params.max_power_filter_max)]
      : parseFloat(params.max_power_filter_single);

    const power_bin_mad_thresh = params.UQ
      ? [parseFloat(params.power_bin_mad_thresh_min), parseFloat(params.power_bin_mad_thresh_max)]
      : parseFloat(params.power_bin_mad_thresh_single);

    return {
      turbine_ids,
      UQ: params.UQ,
      num_sim: parseInt(params.num_sim),
      ws_bins,
      ws_bin_width: parseFloat(params.ws_bin_width),
      vane_bin_width: parseFloat(params.vane_bin_width),
      min_vane_bin_count: parseInt(params.min_vane_bin_count),
      max_abs_vane_angle: parseFloat(params.max_abs_vane_angle),
      pitch_thresh: parseFloat(params.pitch_thresh),
      num_power_bins: parseInt(params.num_power_bins),
      min_power_filter: parseFloat(params.min_power_filter),
      max_power_filter,
      power_bin_mad_thresh,
      use_power_coeff: params.use_power_coeff,
    };
  };

  return (
    <div className={styles.page}>
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroBadge}>
          <span className={styles.heroDot} />
          OPENOA · STATIC YAW MISALIGNMENT
        </div>
        <h1 className={styles.heroTitle}>
          Static Yaw<br />
          <span className={styles.heroAccent}>Misalignment Estimator</span>
        </h1>
        <p className={styles.heroSub}>
          Turbine-level yaw misalignment detection via cosine curve fitting
          across wind speed bins — with optional Monte Carlo UQ.
        </p>
        <div className={styles.featurePills}>
          {["Cosine curve fitting", "Monte Carlo UQ", "Per-turbine bins", "Power curve filtering", "Wind vane analysis"].map((f) => (
            <span key={f} className={styles.pill}>{f}</span>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className={styles.formWrapper}>

        {/* CORE */}
        <Section title="Core Settings" tag="Required" open={expanded.core} onToggle={() => toggleSection("core")}>
          <div className={styles.grid2}>
            <Field label="Turbine IDs" hint="turbine_ids"
              tooltip="Comma-separated list of turbine IDs to analyze. Leave blank to analyze all turbines." span={2}>
              <input className={styles.input} type="text"
                placeholder="e.g. T01, T02, T03  (blank = all)"
                value={params.turbine_ids} onChange={(e) => set("turbine_ids", e.target.value)} />
            </Field>

            <Field label="Uncertainty Quantification (UQ)" hint="UQ"
              tooltip="Run Monte Carlo simulations to derive 95% confidence intervals.">
              <Toggle id="uq-toggle" checked={params.UQ} onChange={(e) => set("UQ", e.target.checked)} />
            </Field>

            {params.UQ && (
              <Field label="Simulations" hint="num_sim"
                tooltip="Number of Monte Carlo iterations. Only used when UQ is enabled.">
                <input className={styles.input} type="number" min={10} max={10000}
                  value={params.num_sim} onChange={(e) => set("num_sim", e.target.value)} />
              </Field>
            )}

            <Field label="Use Power Coefficient" hint="use_power_coeff"
              tooltip="Normalize power by wind speed cubed to approximate Cp instead of raw power.">
              <Toggle id="pc-toggle" checked={params.use_power_coeff} onChange={(e) => set("use_power_coeff", e.target.checked)} />
            </Field>
          </div>
        </Section>

        {/* BINNING */}
        <Section title="Binning Parameters" tag="Binning" open={expanded.binning} onToggle={() => toggleSection("binning")}>
          <div className={styles.grid2}>
            <Field label="Wind Speed Bins (m/s)" hint="ws_bins"
              tooltip="Comma-separated bin centers for yaw misalignment detection." span={2}>
              <input className={styles.input} type="text"
                value={params.ws_bins} onChange={(e) => set("ws_bins", e.target.value)}
                placeholder="5.0, 6.0, 7.0, 8.0" />
            </Field>
            <Field label="Wind Speed Bin Width (m/s)" hint="ws_bin_width"
              tooltip="Size of each wind speed bin (±half-width around center).">
              <input className={styles.input} type="number" step={0.1} min={0.1}
                value={params.ws_bin_width} onChange={(e) => set("ws_bin_width", e.target.value)} />
            </Field>
            <Field label="Wind Vane Bin Width (°)" hint="vane_bin_width"
              tooltip="Angular resolution of wind vane bins.">
              <input className={styles.input} type="number" step={0.5} min={0.1}
                value={params.vane_bin_width} onChange={(e) => set("vane_bin_width", e.target.value)} />
            </Field>
            <Field label="Min Vane Bin Count" hint="min_vane_bin_count"
              tooltip="Minimum data points required in a wind vane bin to be included.">
              <input className={styles.input} type="number" min={1}
                value={params.min_vane_bin_count} onChange={(e) => set("min_vane_bin_count", e.target.value)} />
            </Field>
            <Field label="Max Absolute Vane Angle (°)" hint="max_abs_vane_angle"
              tooltip="Maximum wind vane angle magnitude considered for analysis.">
              <input className={styles.input} type="number" step={0.5} min={1}
                value={params.max_abs_vane_angle} onChange={(e) => set("max_abs_vane_angle", e.target.value)} />
            </Field>
          </div>
        </Section>

        {/* FILTERING */}
        <Section title="Power Curve Filtering" tag="Filtering" open={expanded.filtering} onToggle={() => toggleSection("filtering")}>
          <div className={styles.grid2}>
            <Field label="Pitch Threshold (°)" hint="pitch_thresh"
              tooltip="Max blade pitch angle — removes above-rated timestamps.">
              <input className={styles.input} type="number" step={0.1} min={0}
                value={params.pitch_thresh} onChange={(e) => set("pitch_thresh", e.target.value)} />
            </Field>
            <Field label="Number of Power Bins" hint="num_power_bins"
              tooltip="Bins used for power curve outlier filtering.">
              <input className={styles.input} type="number" min={5}
                value={params.num_power_bins} onChange={(e) => set("num_power_bins", e.target.value)} />
            </Field>
            <Field label="Min Power Filter (fraction)" hint="min_power_filter"
              tooltip="Lower bound of power range (as fraction of rated) where filter is applied.">
              <input className={styles.input} type="number" step={0.01} min={0} max={1}
                value={params.min_power_filter} onChange={(e) => set("min_power_filter", e.target.value)} />
            </Field>

            {params.UQ ? (
              <Field label="Max Power Filter Range (UQ)" hint="max_power_filter"
                tooltip="Monte Carlo sampled range [min, max] as fraction of rated power.">
                <div className={styles.rangeGroup}>
                  <input className={styles.input} type="number" step={0.01} min={0} max={1} placeholder="min"
                    value={params.max_power_filter_min} onChange={(e) => set("max_power_filter_min", e.target.value)} />
                  <span className={styles.rangeSep}>→</span>
                  <input className={styles.input} type="number" step={0.01} min={0} max={1} placeholder="max"
                    value={params.max_power_filter_max} onChange={(e) => set("max_power_filter_max", e.target.value)} />
                </div>
              </Field>
            ) : (
              <Field label="Max Power Filter (fraction)" hint="max_power_filter"
                tooltip="Upper power threshold as fraction of rated power.">
                <input className={styles.input} type="number" step={0.01} min={0} max={1}
                  value={params.max_power_filter_single} onChange={(e) => set("max_power_filter_single", e.target.value)} />
              </Field>
            )}

            {params.UQ ? (
              <Field label="Power Bin MAD Thresh Range (UQ)" hint="power_bin_mad_thresh"
                tooltip="Monte Carlo range for number of MADs from median wind speed in each power bin." span={2}>
                <div className={styles.rangeGroup}>
                  <input className={styles.input} type="number" step={0.5} min={0} placeholder="min"
                    value={params.power_bin_mad_thresh_min} onChange={(e) => set("power_bin_mad_thresh_min", e.target.value)} />
                  <span className={styles.rangeSep}>→</span>
                  <input className={styles.input} type="number" step={0.5} min={0} placeholder="max"
                    value={params.power_bin_mad_thresh_max} onChange={(e) => set("power_bin_mad_thresh_max", e.target.value)} />
                </div>
              </Field>
            ) : (
              <Field label="Power Bin MAD Threshold" hint="power_bin_mad_thresh"
                tooltip="Number of MADs from median wind speed to flag abnormal operation.">
                <input className={styles.input} type="number" step={0.5} min={0}
                  value={params.power_bin_mad_thresh_single} onChange={(e) => set("power_bin_mad_thresh_single", e.target.value)} />
              </Field>
            )}
          </div>
        </Section>

        {/* Actions */}
        <div className={styles.actions}>
          <button className={styles.resetBtn} onClick={() => setParams(DEFAULT_PARAMS)}>
            Reset Defaults
          </button>
          <button className={styles.runBtn} onClick={() => onSubmit(buildPayload())}>
            <span className={styles.runBtnIcon}>⚡</span>
            Run Analysis
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────

export default function StaticYaw() {
  const [phase, setPhase]     = useState(PHASE.FORM);
  const [results, setResults] = useState(null);
  const [error, setError]     = useState(null);
  const [uqParams, setUqParams] = useState({ uq: true, numSim: 100 });

  const handleSubmit = async (payload) => {
    setUqParams({ uq: payload.UQ, numSim: payload.num_sim });
    setPhase(PHASE.LOADING);
    setResults(null);
    setError(null);

    try {
      // axios sends JSON automatically; session_id from wherever your app stores it
      const sessionId = localStorage.getItem("session_id") ?? "";
      const res  = await axios.post(API_URL, payload, {
        headers: { "X-Session-Id": sessionId },
      });
      const data = res.data;

      if (data.status === "error") {
        setError(data.error || "Unknown backend error.");
        setPhase(PHASE.ERROR);
      } else {
        setResults(data);
        setPhase(PHASE.RESULTS);
      }
    } catch (err) {
      // axios wraps HTTP errors in err.response
      const msg = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message || String(err);
      setError(msg);
      setPhase(PHASE.ERROR);
    }
  };

  const handleBack = () => {
    setPhase(PHASE.FORM);
    setResults(null);
    setError(null);
  };

  return (
    <div className={styles.root}>
      {phase === PHASE.FORM    && <FormPhase    onSubmit={handleSubmit} />}
      {phase === PHASE.LOADING && <LoadingPhase uq={uqParams.uq} numSim={uqParams.numSim} />}
      {phase === PHASE.RESULTS && <ResultsPhase data={results} onBack={handleBack} />}
      {phase === PHASE.ERROR   && <ErrorPhase   error={error}  onBack={handleBack} />}
    </div>
  );
}