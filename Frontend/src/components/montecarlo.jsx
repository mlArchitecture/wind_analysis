import { useState } from "react";
import axios from "axios";
import styles from "./montecarlo.module.css";

export default function MonteCarlo() {
  // State management
  const [stage, setStage] = useState("config"); // 'config', 'loading', 'results'
  const [progress, setProgress] = useState(0);
  
  // Configuration state
  const [config, setConfig] = useState({
    num_sim: 500,
    time_resolution: "MS",//
    reg_model: "lin",//
    uncertainty_meter: 0.005,  //
    uncertainty_losses: 0.05, //
    uncertainty_windiness_min: 10,//
    uncertainty_windiness_max: 20,//
    uncertainty_loss_max_min: 10,//
    uncertainty_loss_max_max: 20,//
    uncertainty_nan_energy: 0.01,
    outlier_detection: false,//
    uncertainty_outlier_min: 1.0,//
    uncertainty_outlier_max: 3.0,//
    reg_temperature: false,//
    reg_wind_direction: false,//
    apply_iav: true,//
    
    end_date_lt: "",//
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

    // Simulate progress (replace with actual progress tracking if backend supports it)
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 500);

    try {
      const response = await axios.post(
        "http://localhost:8000/run-monte-carlo",
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
              Monte Carlo <span>AEP Analysis</span>
            </h1>
            <p>Configure analysis parameters and run simulation</p>
          </div>

          <div className={styles.configGrid}>
            {/* SECTION 1: Primary Settings */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>⚙️</span>
                <h2>Primary Settings</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Number of Simulations
                  <span className={styles.labelHint}>
                    Recommended: 500-10,000
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

              <div className={styles.configCard}>
                <label className={styles.label}>Time Resolution</label>
                <div className={styles.radioGroup}>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="time_resolution"
                      value="MS"
                      checked={config.time_resolution === "MS"}
                      onChange={(e) =>
                        handleChange("time_resolution", e.target.value)
                      }
                    />
                    <span>Monthly (MS)</span>
                  </label>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="time_resolution"
                      value="D"
                      checked={config.time_resolution === "D"}
                      onChange={(e) =>
                        handleChange("time_resolution", e.target.value)
                      }
                    />
                    <span>Daily (D)</span>
                  </label>
                  <label className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="time_resolution"
                      value="h"
                      checked={config.time_resolution === "h"}
                      onChange={(e) =>
                        handleChange("time_resolution", e.target.value)
                      }
                    />
                    <span>Hourly (h)</span>
                  </label>
                </div>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Regression Model
                  <span className={styles.labelHint}>
                    Linear recommended for monthly
                  </span>
                </label>
                <select
                  className={styles.select}
                  value={config.reg_model}
                  onChange={(e) => handleChange("reg_model", e.target.value)}
                  disabled={config.time_resolution === "MS"}
                >
                  <option value="lin">Linear Regression</option>
                  <option value="gam">General Additive Model (GAM)</option>
                  <option value="gbm">Gradient Boosting (GBM)</option>
                  <option value="etr">Extra Trees (ETR)</option>
                </select>
              </div>
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
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Losses Uncertainty
                  <span className={styles.labelValue}>
                    {(config.uncertainty_losses * 100).toFixed(1)}%
                  </span>
                </label>
                <input
                  type="range"
                  className={styles.slider}
                  value={config.uncertainty_losses}
                  onChange={(e) =>
                    handleChange("uncertainty_losses", parseFloat(e.target.value))
                  }
                  min="0.01"
                  max="0.15"
                  step="0.01"
                />
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Windiness Correction Years
                </label>
                <div className={styles.rangeInputs}>
                  <div className={styles.rangeInput}>
                    <span>Min</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_windiness_min}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_windiness_min",
                          parseInt(e.target.value)
                        )
                      }
                      min="5"
                      max="30"
                    />
                  </div>
                  <div className={styles.rangeInput}>
                    <span>Max</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_windiness_max}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_windiness_max",
                          parseInt(e.target.value)
                        )
                      }
                      min="5"
                      max="30"
                    />
                  </div>
                </div>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Loss Threshold (%)
                </label>
                <div className={styles.rangeInputs}>
                  <div className={styles.rangeInput}>
                    <span>Min</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_loss_max_min}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_loss_max_min",
                          parseInt(e.target.value)
                        )
                      }
                      min="5"
                      max="50"
                    />
                  </div>
                  <div className={styles.rangeInput}>
                    <span>Max</span>
                    <input
                      type="number"
                      className={styles.inputSmall}
                      value={config.uncertainty_loss_max_max}
                      onChange={(e) =>
                        handleChange(
                          "uncertainty_loss_max_max",
                          parseInt(e.target.value)
                        )
                      }
                      min="5"
                      max="50"
                    />
                  </div>
                </div>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  NaN Energy Threshold
                  <span className={styles.labelValue}>
                    {(config.uncertainty_nan_energy * 100).toFixed(1)}%
                  </span>
                </label>
                <input
                  type="range"
                  className={styles.slider}
                  value={config.uncertainty_nan_energy}
                  onChange={(e) =>
                    handleChange(
                      "uncertainty_nan_energy",
                      parseFloat(e.target.value)
                    )
                  }
                  min="0.001"
                  max="0.1"
                  step="0.001"
                />
              </div>
            </section>

            {/* SECTION 3: Outlier Detection */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>🔍</span>
                <h2>Outlier Detection</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.outlier_detection}
                    onChange={(e) =>
                      handleChange("outlier_detection", e.target.checked)
                    }
                  />
                  <span>Enable Outlier Detection</span>
                </label>
              </div>

              {config.outlier_detection && (
                <div className={styles.configCard}>
                  <label className={styles.label}>
                    Outlier Threshold Range
                  </label>
                  <div className={styles.rangeInputs}>
                    <div className={styles.rangeInput}>
                      <span>Min</span>
                      <input
                        type="number"
                        className={styles.inputSmall}
                        value={config.uncertainty_outlier_min}
                        onChange={(e) =>
                          handleChange(
                            "uncertainty_outlier_min",
                            parseFloat(e.target.value)
                          )
                        }
                        min="0.5"
                        max="5"
                        step="0.1"
                      />
                    </div>
                    <div className={styles.rangeInput}>
                      <span>Max</span>
                      <input
                        type="number"
                        className={styles.inputSmall}
                        value={config.uncertainty_outlier_max}
                        onChange={(e) =>
                          handleChange(
                            "uncertainty_outlier_max",
                            parseFloat(e.target.value)
                          )
                        }
                        min="0.5"
                        max="5"
                        step="0.1"
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* SECTION 4: Regression Variables */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>📈</span>
                <h2>Regression Inputs</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.reg_temperature}
                    onChange={(e) =>
                      handleChange("reg_temperature", e.target.checked)
                    }
                  />
                  <span>Include Temperature</span>
                </label>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.reg_wind_direction}
                    onChange={(e) =>
                      handleChange("reg_wind_direction", e.target.checked)
                    }
                  />
                  <span>Include Wind Direction</span>
                </label>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.apply_iav}
                    onChange={(e) =>
                      handleChange("apply_iav", e.target.checked)
                    }
                  />
                  <span>Apply Interannual Variability (IAV)</span>
                </label>
              </div>
            </section>

            {/* SECTION 5: Reanalysis Products */}
            <section className={styles.configSection}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionIcon}>🌍</span>
                <h2>Reanalysis Products</h2>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.reanalysis_era5}
                    onChange={(e) =>
                      handleChange("reanalysis_era5", e.target.checked)
                    }
                  />
                  <span>ERA5</span>
                </label>
              </div>

              <div className={styles.configCard}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={config.reanalysis_merra2}
                    onChange={(e) =>
                      handleChange("reanalysis_merra2", e.target.checked)
                    }
                  />
                  <span>MERRA2</span>
                </label>
              </div>

              <div className={styles.configCard}>
                <label className={styles.label}>
                  Long-term Correction End Date
                  <span className={styles.labelHint}>Optional</span>
                </label>
                <input
                  type="date"
                  className={styles.input}
                  value={config.end_date_lt}
                  onChange={(e) => handleChange("end_date_lt", e.target.value)}
                />
              </div>
            </section>
          </div>

          {/* Submit Button */}
          <div className={styles.submitSection}>
            <button className={styles.runButton} onClick={handleRunAnalysis}>
              <span className={styles.runIcon}>▶</span>
              Run Monte Carlo Analysis
            </button>
          </div>
        </div>
      )}

      {/* LOADING STAGE */}
      {stage === "loading" && (
        <div className={styles.loadingStage}>
          <div className={styles.loadingCard}>
            <div className={styles.spinner}></div>
            <h2>Running Monte Carlo Analysis</h2>
            <p>Processing {config.num_sim} simulations...</p>
            
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className={styles.progressText}>{progress}% Complete</p>

            <div className={styles.statusList}>
              <div className={`${styles.statusItem} ${progress > 0 ? styles.complete : ""}`}>
                {progress > 0 ? "✓" : "○"} Data preprocessing
              </div>
              <div className={`${styles.statusItem} ${progress > 20 ? styles.complete : ""}`}>
                {progress > 20 ? "✓" : "○"} Long-term losses calculation
              </div>
              <div className={`${styles.statusItem} ${progress > 40 ? styles.complete : ""}`}>
                {progress > 40 ? "✓" : "○"} Running regressions
              </div>
              <div className={`${styles.statusItem} ${progress > 90 ? styles.complete : ""}`}>
                {progress > 90 ? "✓" : "○"} Calculating statistics
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
              Analysis <span>Results</span>
            </h1>
            <p>Monte Carlo AEP Analysis Complete</p>
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
                  <div className={styles.metricLabel}>Net AEP</div>
                  <div className={styles.metricValue}>
                    {results.aep_mean?.toFixed(1)} GWh/yr
                  </div>
                  <div className={styles.metricSubtext}>
                    ±{results.aep_std?.toFixed(1)} (95% CI)
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>📉</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Availability Loss</div>
                  <div className={styles.metricValue}>
                    {(results.avail_mean * 100)?.toFixed(2)}%
                  </div>
                  <div className={styles.metricSubtext}>
                    ±{(results.avail_std * 100)?.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>✂️</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Curtailment Loss</div>
                  <div className={styles.metricValue}>
                    {(results.curt_mean * 100)?.toFixed(2)}%
                  </div>
                  <div className={styles.metricSubtext}>
                    ±{(results.curt_std * 100)?.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>📊</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>LT/POR Ratio</div>
                  <div className={styles.metricValue}>
                    {results.lt_por_ratio_mean?.toFixed(3)}
                  </div>
                  <div className={styles.metricSubtext}>
                    ±{results.lt_por_ratio_std?.toFixed(3)}
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>🌊</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>IAV</div>
                  <div className={styles.metricValue}>
                    {(results.iav_mean * 100)?.toFixed(2)}%
                  </div>
                  <div className={styles.metricSubtext}>
                    ±{(results.iav_std * 100)?.toFixed(3)}%
                  </div>
                </div>
              </div>

              <div className={styles.metricCard}>
                <div className={styles.metricIcon}>⚙️</div>
                <div className={styles.metricContent}>
                  <div className={styles.metricLabel}>Capacity Factor</div>
                  <div className={styles.metricValue}>
                    {results.capacity_factor?.toFixed(1)}%
                  </div>
                  <div className={styles.metricSubtext}>
                    Annual average
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: Distribution Plots */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Distribution Analysis</h2>
            <div className={styles.plotsGrid}>
              {results.plot_aep_distribution && (
                <div className={styles.plotCard}>
                  <h3>AEP Distribution</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_aep_distribution}`}
                    alt="AEP Distribution"
                    className={styles.plotImage}
                  />
                  <div className={styles.plotStats}>
                    <span>P50: {results.aep_p50?.toFixed(1)} GWh/yr</span>
                    <span>P95: {results.aep_p95?.toFixed(1)} GWh/yr</span>
                  </div>
                </div>
              )}

              {results.plot_avail_distribution && (
                <div className={styles.plotCard}>
                  <h3>Availability Loss Distribution</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_avail_distribution}`}
                    alt="Availability Distribution"
                    className={styles.plotImage}
                  />
                </div>
              )}

              {results.plot_curt_distribution && (
                <div className={styles.plotCard}>
                  <h3>Curtailment Loss Distribution</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_curt_distribution}`}
                    alt="Curtailment Distribution"
                    className={styles.plotImage}
                  />
                </div>
              )}
            </div>
          </section>

          {/* SECTION 3: Time Series */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Time Series Analysis</h2>
            <div className={styles.plotsGrid}>
              {results.plot_energy_timeseries && (
                <div className={styles.plotCardWide}>
                  <h3>Gross Energy Over Time</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_energy_timeseries}`}
                    alt="Energy Time Series"
                    className={styles.plotImage}
                  />
                </div>
              )}

              {results.plot_losses_timeseries && (
                <div className={styles.plotCardWide}>
                  <h3>Availability & Curtailment Losses</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_losses_timeseries}`}
                    alt="Losses Time Series"
                    className={styles.plotImage}
                  />
                </div>
              )}
            </div>
          </section>

          {/* SECTION 4: Reanalysis Analysis */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Wind Resource Analysis</h2>
            <div className={styles.plotsGrid}>
              {results.plot_reanalysis_windspeed && (
                <div className={styles.plotCardWide}>
                  <h3>Normalized Monthly Wind Speed</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_reanalysis_windspeed}`}
                    alt="Reanalysis Wind Speed"
                    className={styles.plotImage}
                  />
                </div>
              )}

              {results.plot_energy_vs_windspeed && (
                <div className={styles.plotCardWide}>
                  <h3>Gross Energy vs Wind Speed</h3>
                  <img
                    src={`data:image/png;base64,${results.plot_energy_vs_windspeed}`}
                    alt="Energy vs Wind Speed"
                    className={styles.plotImage}
                  />
                </div>
              )}
            </div>
          </section>

          {/* SECTION 5: Model Performance */}
          <section className={styles.resultsSection}>
            <h2 className={styles.sectionTitle}>Model Performance</h2>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>R² Score</div>
                <div className={styles.statValue}>
                  {results.r2_mean?.toFixed(3)}
                </div>
                <div className={styles.statRange}>
                  Range: [{results.r2_min?.toFixed(3)}, {results.r2_max?.toFixed(3)}]
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>MSE</div>
                <div className={styles.statValue}>
                  {results.mse_mean?.toFixed(2)}
                </div>
                <div className={styles.statRange}>
                  ±{results.mse_std?.toFixed(2)}
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>Data Points Used</div>
                <div className={styles.statValue}>
                  {results.n_points_mean?.toFixed(0)}
                </div>
                <div className={styles.statRange}>
                  Range: [{results.n_points_min}, {results.n_points_max}]
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>Simulations</div>
                <div className={styles.statValue}>{results.num_sim}</div>
                <div className={styles.statRange}>Completed successfully</div>
              </div>
            </div>
          </section>

          {/* SECTION 6: Data Quality */}
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
                <span className={styles.qualityLabel}>Data Availability:</span>
                <span className={styles.qualityValue}>
                  {results.data_availability?.toFixed(1)}%
                </span>
              </div>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Flagged Periods:</span>
                <span className={styles.qualityValue}>
                  {results.flagged_periods} periods
                </span>
              </div>
              <div className={styles.qualityItem}>
                <span className={styles.qualityLabel}>Outliers Detected:</span>
                <span className={styles.qualityValue}>
                  {results.outliers_detected} points
                </span>
              </div>
            </div>
          </section>

          {/* SECTION 7: Export Options */}
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
                📈 Download All Plots
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