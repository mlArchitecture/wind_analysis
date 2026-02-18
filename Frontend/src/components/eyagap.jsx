import { useState, useCallback } from "react";
import styles from "./eyagap.module.css";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer, LabelList,
} from "recharts";

// ── API base ────────────────────────────────────────────────────
const API = "http://localhost:8000";

// ── Defaults ────────────────────────────────────────────────────
const EYA_DEFAULTS = {
  aep: 12.4,
  gross_energy: 15.2,
  availability_losses: 0.032,
  electrical_losses: 0.015,
  turbine_losses: 0.04,
  blade_degradation_losses: 0.01,
  wake_losses: 0.08,
};
const OA_DEFAULTS = {
  aep: 11.1,
  availability_losses: 0.041,
  electrical_losses: 0.018,
  turbine_ideal_energy: 13.6,
};

// ── Helpers ──────────────────────────────────────────────────────
function pct(v) { return (v * 100).toFixed(2) + "%"; }
function gwh(v) { return (typeof v === "number" ? v.toFixed(3) : "—") + " GWh"; }

function healthBand(gapPct) {
  if (Math.abs(gapPct) <= 5)  return { label: "Within Expectations", color: "#10b981", icon: "●" };
  if (Math.abs(gapPct) <= 10) return { label: "Investigate",          color: "#f59e0b", icon: "◆" };
  return                               { label: "Significant Underperformance", color: "#ef4444", icon: "▲" };
}

function buildWaterfallData(compiled) {
  if (!compiled || compiled.length < 5) return [];
  const labels = ["EYA AEP", "Turbine IE", "Availability", "Electrical", "Unexplained", "OA AEP"];
  let running = 0;
  const rows = [];
  compiled.forEach((val, i) => {
    if (i === 0) {
      rows.push({ name: labels[i], base: 0, value: val, raw: val });
      running = val;
    } else {
      const base = val >= 0 ? running : running + val;
      rows.push({ name: labels[i], base, value: Math.abs(val), raw: val });
      running += val;
    }
  });
  rows.push({ name: labels[5], base: 0, value: running, raw: running, isTotal: true });
  return rows;
}

function exportCSV(lossRows, kpi) {
  const header = "Category,EYA Estimate,OA Result,Difference,Impact (GWh)\n";
  const body = lossRows.map(r =>
    `${r.category},${r.eya},${r.oa},${r.diff},${r.impact}`
  ).join("\n");
  const summary = `\n\nEYA AEP,${kpi.eya_aep}\nOA AEP,${kpi.oa_aep}\nGap,${kpi.gap}\nGap %,${kpi.gapPct}%\n`;
  const blob = new Blob([header + body + summary], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "eya_gap_analysis.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Custom waterfall tooltip ──────────────────────────────────────
function WaterfallTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.payload?.raw;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipLabel}>{label}</div>
      <div className={styles.tooltipVal}>{typeof raw === "number" ? gwh(raw) : "—"}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════
export default function EYAGapAnalysis() {
  const [eya, setEya] = useState({ ...EYA_DEFAULTS });
  const [oa,  setOa]  = useState({ ...OA_DEFAULTS  });

  // sensitivity delta (applied on top of oa for live recalc)
  const [sensitivityAvail, setSensitivityAvail] = useState(0);
  const [sensitivityElec,  setSensitivityElec]  = useState(0);

  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // ── Input handlers ────────────────────────────────────────────
  const setEyaField = (k, v) => setEya(p => ({ ...p, [k]: parseFloat(v) || 0 }));
  const setOaField  = (k, v) => setOa(p  => ({ ...p, [k]: parseFloat(v) || 0 }));

  // ── POST to backend ───────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${API}/eya-gap-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eya_estimates: eya, oa_results: oa }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Backend error");
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [eya, oa]);

  // ── Derive display values ─────────────────────────────────────
  // Apply sensitivity deltas for live sliders (frontend only)
  const adjOa = {
    ...oa,
    availability_losses: Math.min(0.999, Math.max(0, oa.availability_losses + sensitivityAvail)),
    electrical_losses:   Math.min(0.999, Math.max(0, oa.electrical_losses   + sensitivityElec)),
  };

  // Recalc compiled_data locally for live sensitivity preview
  const eyaTIE = eya.gross_energy
    * (1 - eya.turbine_losses)
    * (1 - eya.wake_losses)
    * (1 - eya.blade_degradation_losses);

  const liveCompiled = result ? (() => {
    const turbDiff  = adjOa.turbine_ideal_energy - eyaTIE;
    const availDiff = (eya.availability_losses - adjOa.availability_losses) * eyaTIE;
    const elecDiff  = (eya.electrical_losses   - adjOa.electrical_losses)   * eyaTIE;
    const unacc     = -(eya.aep + turbDiff + availDiff + elecDiff) + adjOa.aep;
    return [eya.aep, turbDiff, availDiff, elecDiff, unacc];
  })() : result?.compiled_data;

  const waterfallData = buildWaterfallData(liveCompiled);

  const gapRaw = result ? (adjOa.aep - eya.aep) : null;
  const gapPct = gapRaw !== null ? ((gapRaw / eya.aep) * 100) : null;
  const health  = gapPct !== null ? healthBand(gapPct) : null;

  // Loss breakdown rows for table
  const lossRows = result ? [
    {
      category: "Turbine Ideal Energy",
      eya: gwh(eyaTIE),
      oa:  gwh(adjOa.turbine_ideal_energy),
      diff: gwh(adjOa.turbine_ideal_energy - eyaTIE),
      impact: gwh(adjOa.turbine_ideal_energy - eyaTIE),
      rawDiff: adjOa.turbine_ideal_energy - eyaTIE,
    },
    {
      category: "Availability Losses",
      eya: pct(eya.availability_losses),
      oa:  pct(adjOa.availability_losses),
      diff: pct(adjOa.availability_losses - eya.availability_losses),
      impact: gwh((eya.availability_losses - adjOa.availability_losses) * eyaTIE),
      rawDiff: adjOa.availability_losses - eya.availability_losses,
    },
    {
      category: "Electrical Losses",
      eya: pct(eya.electrical_losses),
      oa:  pct(adjOa.electrical_losses),
      diff: pct(adjOa.electrical_losses - eya.electrical_losses),
      impact: gwh((eya.electrical_losses - adjOa.electrical_losses) * eyaTIE),
      rawDiff: adjOa.electrical_losses - eya.electrical_losses,
    },
    {
      category: "Unexplained",
      eya: "—",
      oa:  "—",
      diff: "—",
      impact: gwh(liveCompiled?.[4] ?? 0),
      rawDiff: liveCompiled?.[4] ?? 0,
    },
  ] : [];

  // Auto-generated findings text
  const findings = result ? (() => {
    const biggestDriver = lossRows.reduce((a, b) =>
      Math.abs(a.rawDiff) > Math.abs(b.rawDiff) ? a : b
    );
    const gapDir = gapRaw >= 0 ? "exceeded" : "fell short of";
    const sign   = gapRaw >= 0 ? "+" : "";
    return `Operational AEP (${gwh(adjOa.aep)}) ${gapDir} EYA estimates (${gwh(eya.aep)}) ` +
      `by ${sign}${gwh(gapRaw)} (${sign}${gapPct?.toFixed(1)}%). ` +
      `The largest contributor to the gap was ${biggestDriver.category} ` +
      `(impact: ${biggestDriver.impact}). ` +
      (liveCompiled?.[4]
        ? `An unexplained residual of ${gwh(liveCompiled[4])} remains unaccounted for by the three key metrics.`
        : "");
  })() : null;

  const kpi = result ? {
    eya_aep: gwh(eya.aep),
    oa_aep:  gwh(adjOa.aep),
    gap:     gwh(gapRaw),
    gapPct:  gapPct?.toFixed(2),
  } : null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* ── HEADER ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>⚡</span>
          <div>
            <h1 className={styles.headerTitle}>EYA Gap Analysis</h1>
            <p className={styles.headerSub}>Energy Yield Assessment vs Operational Assessment</p>
          </div>
        </div>
        {health && (
          <div className={styles.healthBadge} style={{ borderColor: health.color, color: health.color }}>
            <span>{health.icon}</span>
            <span>{health.label}</span>
          </div>
        )}
      </header>

      <div className={styles.body}>

        {/* ── INPUT PANELS ── */}
        <div className={styles.inputGrid}>

          {/* EYA Panel */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelDot} style={{ background: "#0ea5e9" }} />
              EYA Estimates
            </div>
            {[
              { k: "aep",                      label: "AEP (GWh/yr)",                  step: 0.1  },
              { k: "gross_energy",              label: "Gross Energy (GWh/yr)",         step: 0.1  },
              { k: "availability_losses",       label: "Availability Losses (0–1)",     step: 0.001},
              { k: "electrical_losses",         label: "Electrical Losses (0–1)",       step: 0.001},
              { k: "turbine_losses",            label: "Turbine Losses (0–1)",          step: 0.001},
              { k: "blade_degradation_losses",  label: "Blade Degradation Losses (0–1)",step: 0.001},
              { k: "wake_losses",               label: "Wake Losses (0–1)",             step: 0.001},
            ].map(({ k, label, step }) => (
              <div className={styles.fieldRow} key={k}>
                <label className={styles.fieldLabel}>{label}</label>
                <input
                  type="number" step={step} min={0}
                  max={k.includes("losses") ? 0.999 : undefined}
                  value={eya[k]}
                  onChange={e => setEyaField(k, e.target.value)}
                  className={styles.fieldInput}
                />
              </div>
            ))}
          </div>

          {/* OA Panel */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelDot} style={{ background: "#10b981" }} />
              OA Results
            </div>
            {[
              { k: "aep",                  label: "AEP (GWh/yr)",                step: 0.1   },
              { k: "turbine_ideal_energy", label: "Turbine Ideal Energy (GWh/yr)",step: 0.1   },
              { k: "availability_losses",  label: "Availability Losses (0–1)",   step: 0.001 },
              { k: "electrical_losses",    label: "Electrical Losses (0–1)",     step: 0.001 },
            ].map(({ k, label, step }) => (
              <div className={styles.fieldRow} key={k}>
                <label className={styles.fieldLabel}>{label}</label>
                <input
                  type="number" step={step} min={0}
                  max={k.includes("losses") ? 0.999 : undefined}
                  value={oa[k]}
                  onChange={e => setOaField(k, e.target.value)}
                  className={styles.fieldInput}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── RUN BUTTON ── */}
        <div className={styles.runRow}>
          <button
            className={styles.runBtn}
            onClick={runAnalysis}
            disabled={loading}
          >
            {loading ? <span className={styles.spinner} /> : "▶ Run Gap Analysis"}
          </button>
          {error && <span className={styles.errorMsg}>⚠ {error}</span>}
        </div>

        {/* ── RESULTS ── */}
        {result && (
          <div className={styles.results}>

            {/* KPI CARDS */}
            <div className={styles.kpiRow}>
              {[
                { label: "EYA AEP",  value: gwh(eya.aep),      color: "#0ea5e9" },
                { label: "OA AEP",   value: gwh(adjOa.aep),    color: "#10b981" },
                {
                  label: "Gap",
                  value: (gapRaw >= 0 ? "+" : "") + gwh(gapRaw),
                  color: health.color,
                },
                {
                  label: "Gap %",
                  value: (gapPct >= 0 ? "+" : "") + gapPct?.toFixed(2) + "%",
                  color: health.color,
                },
              ].map(c => (
                <div className={styles.kpiCard} key={c.label}>
                  <div className={styles.kpiValue} style={{ color: c.color }}>{c.value}</div>
                  <div className={styles.kpiLabel}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* WATERFALL CHART */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Waterfall Chart</h2>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={340}>
                  <ComposedChart data={waterfallData} margin={{ top: 20, right: 30, left: 20, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false}
                      tickFormatter={v => v.toFixed(1)} label={{ value: "GWh/yr", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 11 }} />
                    <Tooltip content={<WaterfallTooltip />} />
                    <ReferenceLine y={0} stroke="#334155" />
                    {/* Invisible base bar for floating effect */}
                    <Bar dataKey="base" stackId="a" fill="transparent" />
                    <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.isTotal ? "#0ea5e9"
                            : entry.raw > 0 ? "#10b981"
                            : entry.raw < 0 ? "#ef4444"
                            : "#0ea5e9"
                          }
                        />
                      ))}
                      <LabelList
                        dataKey="raw"
                        position="top"
                        formatter={v => typeof v === "number" ? v.toFixed(2) : ""}
                        style={{ fill: "#94a3b8", fontSize: 11 }}
                      />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}><span style={{ background: "#10b981" }} />Positive</span>
                <span className={styles.legendItem}><span style={{ background: "#ef4444" }} />Negative</span>
                <span className={styles.legendItem}><span style={{ background: "#0ea5e9" }} />Total AEP</span>
              </div>
            </div>

            {/* SENSITIVITY SLIDERS */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Sensitivity Analysis <span className={styles.liveTag}>LIVE</span></h2>
              <p className={styles.sectionSub}>Adjust sliders to see how changes in OA metrics affect the gap in real time.</p>
              <div className={styles.sliderGrid}>
                <div className={styles.sliderRow}>
                  <label className={styles.sliderLabel}>
                    Availability Loss Δ
                    <span className={styles.sliderVal}>
                      {sensitivityAvail >= 0 ? "+" : ""}{(sensitivityAvail * 100).toFixed(2)}%
                    </span>
                  </label>
                  <input type="range" min={-0.05} max={0.05} step={0.001}
                    value={sensitivityAvail}
                    onChange={e => setSensitivityAvail(parseFloat(e.target.value))}
                    className={styles.slider}
                  />
                  <div className={styles.sliderBounds}><span>−5%</span><span>0</span><span>+5%</span></div>
                </div>
                <div className={styles.sliderRow}>
                  <label className={styles.sliderLabel}>
                    Electrical Loss Δ
                    <span className={styles.sliderVal}>
                      {sensitivityElec >= 0 ? "+" : ""}{(sensitivityElec * 100).toFixed(2)}%
                    </span>
                  </label>
                  <input type="range" min={-0.05} max={0.05} step={0.001}
                    value={sensitivityElec}
                    onChange={e => setSensitivityElec(parseFloat(e.target.value))}
                    className={styles.slider}
                  />
                  <div className={styles.sliderBounds}><span>−5%</span><span>0</span><span>+5%</span></div>
                </div>
              </div>
            </div>

            {/* LOSS BREAKDOWN TABLE */}
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Loss Breakdown</h2>
                <button className={styles.exportBtn} onClick={() => exportCSV(lossRows, kpi)}>
                  ↓ Export CSV
                </button>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {["Category", "EYA Estimate", "OA Result", "Difference", "AEP Impact"].map(h => (
                        <th key={h} className={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lossRows.map(row => (
                      <tr key={row.category} className={styles.tr}>
                        <td className={styles.tdBold}>{row.category}</td>
                        <td className={styles.td}>{row.eya}</td>
                        <td className={styles.td}>{row.oa}</td>
                        <td className={styles.td} style={{
                          color: row.rawDiff > 0 ? "#ef4444" : row.rawDiff < 0 ? "#10b981" : "#94a3b8"
                        }}>{row.diff}</td>
                        <td className={styles.td} style={{
                          color: row.rawDiff > 0 ? "#ef4444" : row.rawDiff < 0 ? "#10b981" : "#94a3b8",
                          fontWeight: 700,
                        }}>{row.impact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AUTO-GENERATED FINDINGS */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Findings Summary</h2>
              <div className={styles.findings}>
                <span className={styles.findingsIcon} style={{ color: health.color }}>
                  {health.icon}
                </span>
                <p className={styles.findingsText}>{findings}</p>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}