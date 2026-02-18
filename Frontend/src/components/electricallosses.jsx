import { useState } from "react";
import axios from "axios";
import styles from "./ElectricalLosses.module.css";

export default function ElectricalLosses() {
  // State management
  const [stage, setStage] = useState("config"); // 'config', 'loading', 'results'
  const [progress, setProgress] = useState(0);
  
  // Configuration state
  const [config, setConfig] = useState({
    UQ: true,
    num_sim: 500,
    uncertainty_meter: 0.005,
    uncertainty_scada: 0.005,
    uncertainty_correction_threshold_min: 0.9,
    uncertainty_correction_threshold_max: 0.995,
  });

  // Results state
  const [results, setResults] = useState(null);

  // Handle input changes
  const handleChange = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  // Submit configuration and run analysis
  const handleRunAnalysis = async () => {
    setStage("loading");
    setProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 400);

    try {
      const response = await axios.post(
        "http://localhost:8000/run-electrical-losses",
        config,
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      clearInterval(progressInterval);
      setProgress(100);
      
      setTimeout(() => {
        setResults(response.data);
        setStage("results");
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      console.error("Analysis error:", error);
      alert("Analysis failed. Please try again.");
      setStage("config");
    }
  };

  return (
    <div className={styles.container}>
      {/* CONFIG STAGE */}
      {stage === "config" && (
        <div className={styles.configStage}>
          <div className={styles.pageHeader}>
            <h1>
              Electrical <span>Losses Analysis</span>
            </h1>
            <p>Calculate monthly and annual electrical losses with uncertainty quantification</p>
          </div>

          <div className={styles.configGrid}>
            {/* SECTION 1: Primary Settings */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>⚡</span>
                <h2>Analysis Configuration</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.UQ}
                    onChange={(e) => handleChange("UQ", e.target.checked)}
                  />
                  <span>
                    Enable Uncertainty Quantification (UQ)
                    <span className={styles.labelHint}>
                      Monte Carlo simulation for uncertainty analysis
                    </span>
                  </span>
                </label>
              </div>

              {config.UQ && (
                <div className={styles.configCard}>
                  <label className={styles.label}>
                    Number of Simulations
                    <span className={styles.labelHint}>
                      Recommended: 500-20,000
                    </span>
                  </label>
                  <input
                    type="number"
                    className={styles.input}
                    value={config.num_sim}
                    onChange={(e) =>
                      handleChange("num_sim", parseInt(e.target.value))
                    }
                    min="100"
                    max="20000"
                    step="100"
                  />
                  <input
                    type="range"
                    className={styles.slider}
                    value={config.num_sim}
                    onChange={(e) =>
                      handleChange("num_sim", parseInt(e.target.value))
                    }
                    min="100"
                    max="10000"
                    step="100"
                  />
                </div>
              )}
            </section>

            {/* SECTION 2: Uncertainty Parameters */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>📊</span>
                <h2>Uncertainty Parameters</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Revenue Meter Uncertainty
                  <span className={styles.labelValue}>
                    {(config.uncertainty_meter * 100).toFixed(2)}%
                  </span>
                </label>
                <input
                  type="range"
                  className={styles.slider}
                  value={config.uncertainty_meter}
                  onChange={(e) =>
                    handleChange("uncertainty_meter", parseFloat(e.target.value))
                  }
                  min="0.001"
                  max="0.02"
                  step="0.001"
                />
                <div className={styles.sliderLabels}>
                  <span>0.1%</span>
                  <span>2.0%</span>
                </div>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  SCADA Data Uncertainty
                  <span className={styles.labelValue}>
                    {(config.uncertainty_scada * 100).toFixed(2)}%
                  </span>
                </label>
                <input
                  type="range"
                  className={styles.slider}
                  value={config.uncertainty_scada}
                  onChange={(e) =>
                    handleChange("uncertainty_scada", parseFloat(e.target.value))
                  }
                  min="0.001"
                  max="0.02"
                  step="0.001"
                />
                <div className={styles.sliderLabels}>
                  <span>0.1%</span>
                  <span>2.0%</span>
                </div>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Data Availability Threshold Range
                  <span className={styles.labelHint}>
                    Months below threshold are excluded
                  </span>
                </label>
                <div className={styles.rangeInputs}>
                  <div className={styles.rangeInput}>
                    <span>Min</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_correction_threshold_min}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_correction_threshold_min",
                          parseFloat(e.target.value)
                        )
                      }
                      min="0.5"
                      max="1.0"
                      step="0.01"
                    />
                  </div>
                  <div className={styles.rangeInput}>
                    <span>Max</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_correction_threshold_max}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_correction_threshold_max",
                          parseFloat(e.target.value)
                        )
                      }
                      min="0.5"
                      max="1.0"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className={styles.sliderLabels}>
                  <span>50% availability</span>
                  <span>100% availability</span>
                </div>
              </div>
            </section>

            {/* SECTION 3: Information Panel */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>ℹ️</span>
                <h2>Analysis Information</h2>
              </div>

              <div className={styles.infoPanel}>
                <p className={styles.infoText}>
                  <strong>Electrical Losses</strong> are calculated by comparing
                  energy production from turbine SCADA meters against the revenue
                  meter.
                </p>
                <p className={styles.infoText}>
                  The analysis computes daily sums where all turbines and the
                  revenue meter report at every timestep, ensuring accurate
                  comparison.
                </p>
                <p className={styles.infoText}>
                  <strong>Uncertainty Quantification</strong> uses Monte Carlo
                  sampling to account for measurement uncertainties and data
                  availability variations.
                </p>
              </div>

              <div className={styles.methodBox}>
                <h4>Calculation Method</h4>
                <div className={styles.formula}>
                  Loss = 1 - (Meter Energy / Turbine Energy)
                </div>
                <p className={styles.formulaNote}>
                  Expressed as a percentage of turbine energy production
                </p>
              </div>
            </section>
          </div>

          {/* Submit Button */}
          <div className={styles.submitSection}>
            <button className={styles.runButton} onClick={handleRunAnalysis}>
              <span className={styles.runIcon}>▶</span>
              Run Electrical Losses Analysis
            </button>
          </div>
        </div>
      )}

      {/* LOADING STAGE */}
      {stage === "loading" && (
        <div className={styles.loadingStage}>
          <div className={styles.loadingCard}>
            <div className={styles.spinner}></div>
            <h2>Calculating Electrical Losses</h2>
            <p>
              {config.UQ
                ? `Processing ${config.num_sim} Monte Carlo simulations...`
                : "Processing data..."}
            </p>
            
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className={styles.progressText}>{progress}% Complete</p>

            <div className={styles.statusList}>
              <div className={`${styles.statusItem} ${progress > 0 ? styles.complete : ""}`}>
                {progress > 0 ? "✓" : "○"} Processing SCADA data
              </div>
              <div className={`${styles.statusItem} ${progress > 25 ? styles.complete : ""}`}>
                {progress > 25 ? "✓" : "○"} Processing meter data
              </div>
              <div className={`${styles.statusItem} ${progress > 50 ? styles.complete : ""}`}>
                {progress > 50 ? "✓" : "○"} Calculating daily sums
              </div>
              <div className={`${styles.statusItem} ${progress > 90 ? styles.complete : ""}`}>
                {progress > 90 ? "✓" : "○"} Computing electrical losses
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RESULTS STAGE */}
      {stage === "results" && results && (
        <div className={styles.resultsStage}>
          <div className={styles.pageHeader}>
            <h1>
              Electrical Losses <span>Results</span>
            </h1>
            <p>Analysis Complete - Turbine vs Meter Energy Comparison</p>
            <button
              className={styles.backButton}
              onClick={() => setStage("config")}
            >
              ← Back to Configuration
            </button>
          </div>

          {/* SECTION 1: Summary Cards */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Key Metrics</h2>
            <div className={styles.metricsGrid}>
              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>⚡</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Average Electrical Loss</div>
                  <div className={styles.metricValue}>
                    {(results.loss_mean * 100)?.toFixed(2)}%
                  </div>
                  {config.UQ && (
                    <div className={styles.metricSubtext}>
                      ±{(results.loss_std * 100)?.toFixed(2)}% (1σ)
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>🔋</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Total Turbine Energy</div>
                  <div className={styles.metricValue}>
                    {(results.total_turbine_energy / 1000)?.toFixed(1)} GWh
                  </div>
                  <div className={styles.metricSubtext}>
                    Period of record
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>📊</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Total Meter Energy</div>
                  <div className={styles.metricValue}>
                    {(results.total_meter_energy / 1000)?.toFixed(1)} GWh
                  </div>
                  <div className={styles.metricSubtext}>
                    Period of record
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>📉</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Energy Lost</div>
                  <div className={styles.metricValue}>
                    {(results.energy_lost / 1000)?.toFixed(2)} GWh
                  </div>
                  <div className={styles.metricSubtext}>
                    Total over period
                  </div>
                </div>
              </div>

              {config.UQ && (
                <>
                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon}>📈</div>
                    <div className={styles.metricContent}>
                      <div className={styles.metricLabel}>95th Percentile Loss</div>
                      <div className={styles.metricValue}>
                        {(results.loss_p95 * 100)?.toFixed(2)}%
                      </div>
                      <div className={styles.metricSubtext}>
                        Upper confidence bound
                      </div>
                    </div>
                  </div>

                  <div className={styles.metricCard}>
                    <div className={styles.metricIcon}>📉</div>
                    <div className={styles.metricContent}>
                      <div className={styles.metricLabel}>5th Percentile Loss</div>
                      <div className={styles.metricValue}>
                        {(results.loss_p5 * 100)?.toFixed(2)}%
                      </div>
                      <div className={styles.metricSubtext}>
                        Lower confidence bound
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* SECTION 2: Monthly Losses Plot */}
          {results.plot_monthly_losses && (
            <section className={styles.resultsSection}>
              <h2 className={styles.sectionTitle}>Monthly Loss Trend</h2>
              <div className={styles.plotCardWide}>
                <img
                  src={`data:image/png;base64,${results.plot_monthly_losses}`}
                  alt="Monthly Electrical Losses"
                  className={styles.plotImage}
                />
                <div className={styles.plotCaption}>
                  Time series showing electrical losses as a percentage over the analysis period
                </div>
              </div>
            </section>
          )}

          {/* SECTION 3: Distribution Plot */}
          {config.UQ && results.plot_loss_distribution && (
            <section className={styles.resultsSection}>
              <h2 className={styles.sectionTitle}>Loss Distribution</h2>
              <div className={styles.plotCard}>
                <img
                  src={`data:image/png;base64,${results.plot_loss_distribution}`}
                  alt="Loss Distribution"
                  className={styles.plotImage}
                />
                <div className={styles.plotStats}>
                  <span>Mean: {(results.loss_mean * 100)?.toFixed(2)}%</span>
                  <span>Median: {(results.loss_median * 100)?.toFixed(2)}%</span>
                  <span>Std Dev: {(results.loss_std * 100)?.toFixed(2)}%</span>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 4: Data Quality */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Data Quality Report</h2>
            <div className={styles.qualityCard}>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Analysis Period:</span>
                <span className={styles.qualityValue}>
                  {results.start_date} to {results.end_date}
                </span>
              </div>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Total Days Analyzed:</span>
                <span className={styles.qualityValue}>
                  {results.total_days} days
                </span>
              </div>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Days with Complete Data:</span>
                <span className={styles.qualityValue}>
                  {results.complete_days} days ({results.data_completeness?.toFixed(1)}%)
                </span>
              </div>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Number of Turbines:</span>
                <span className={styles.qualityValue}>
                  {results.num_turbines} turbines
                </span>
              </div>
              {config.UQ && (
                <div className={styles.qualityItem}>
                  <span className={styles.qualityLabel}>Monte Carlo Simulations:</span>
                  <span className={styles.qualityValue}>
                    {results.num_sim} iterations
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 5: Summary Statistics */}
          {config.UQ && (
            <section className={styles.resultsSection}>
              <h2 className={styles.sectionTitle}>Statistical Summary</h2>
              <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Mean Loss</div>
                  <div className={styles.statValue}>
                    {(results.loss_mean * 100)?.toFixed(3)}%
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Median Loss</div>
                  <div className={styles.statValue}>
                    {(results.loss_median * 100)?.toFixed(3)}%
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Standard Deviation</div>
                  <div className={styles.statValue}>
                    {(results.loss_std * 100)?.toFixed(3)}%
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statLabel}>Coefficient of Variation</div>
                  <div className={styles.statValue}>
                    {((results.loss_std / results.loss_mean) * 100)?.toFixed(2)}%
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* SECTION 6: Export Options */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Export Results</h2>
            <div className={styles.exportButtons}>
              <button className={styles.exportButton}>
                📄 Download PDF Report
              </button>
              <button className={styles.exportButton}>
                📊 Download Excel Data
              </button>
              <button className={styles.exportButton}>
                📈 Download Plots
              </button>
              <button className={styles.exportButton}>
                📋 Download CSV Results
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}