import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, Area, AreaChart, ComposedChart } from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Download, Zap, Wind, Activity, ChevronDown, ChevronRight, Settings, PlayCircle, Loader, ArrowLeft } from 'lucide-react';
import styles from './turbinegross.module.css';
import axios from 'axios'

const TurbineGrossEnergy = () => {
  // ─────────────────────────────────────────────────────────────
  // STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  // PAGE CONTROL — 'input' | 'results'
  const [page, setPage] = useState('input');

  const [config, setConfig] = useState({
    UQ: true,
    num_sim: 500,
    uncertainty_scada: 0.005,
    wind_bin_threshold_min: 1.0,
    wind_bin_threshold_max: 3.0,
    max_power_filter_min: 0.8,
    max_power_filter_max: 0.9,
    correction_threshold_min: 0.85,
    correction_threshold_max: 0.95,
  });

  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTurbine, setSelectedTurbine] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedSections, setExpandedSections] = useState({
    config: true,
    distribution: true,
    turbines: true,
  });

  // ─────────────────────────────────────────────────────────────
  // API CALLS
  // ─────────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.post('/turbine-gross-energy', {
        config,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const data = await response.json();
      setResults(data);

      // Set first turbine as selected
      if (data.turbine_results && data.turbine_results.length > 0) {
        setSelectedTurbine(data.turbine_results[0]);
      }

      // ── Switch to results page after data is ready ──
      setPage('results');

    } catch (err) {
      setError(err.message);
      console.error('Analysis error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // UI HELPERS
  // ─────────────────────────────────────────────────────────────

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getStatusColor = (status) => {
    const colors = {
      excellent: '#22c55e',
      good: '#3b82f6',
      fair: '#f97316',
      poor: '#ef4444',
    };
    return colors[status] || '#94a3b8';
  };

  const StatusBadge = ({ status, health }) => {
    const Icon = status === 'excellent' || status === 'good' ? CheckCircle : AlertTriangle;
    return (
      <div className={styles.statusBadge} style={{ backgroundColor: `${getStatusColor(status)}20`, color: getStatusColor(status) }}>
        <Icon size={14} />
        <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
        <span className={styles.healthPct}>{health.toFixed(0)}%</span>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // DATA TRANSFORMATIONS
  // ─────────────────────────────────────────────────────────────

  const getWaterfallData = () => {
    if (!selectedTurbine) return [];
    const gross = selectedTurbine.gross_energy_mwh;
    const flagged = gross * (selectedTurbine.data_flagged_pct / 100);
    const afterFiltering = gross - flagged;
    return [
      { category: 'Raw Data', value: gross, cumulative: gross },
      { category: 'Flagged Data', value: -flagged, cumulative: afterFiltering },
      { category: 'Modeled Gross', value: afterFiltering, cumulative: afterFiltering },
    ];
  };

  const getMonthlyChartData = () => {
    if (!results?.monthly_data) return [];
    return results.monthly_data.map(month => {
      const total = Object.values(month.turbine_data).reduce((sum, val) => sum + val, 0);
      return {
        month: month.month,
        total: total / 1000,
        ...month.turbine_data,
      };
    });
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER: LOADING OVERLAY
  // ─────────────────────────────────────────────────────────────

  const renderLoadingOverlay = () => (
    <div className={styles.loadingOverlay}>
      <div className={styles.loadingCard}>
        <Wind size={40} color="#818cf8" />
        <p className={styles.loadingTitle}>Running Analysis</p>
        <p className={styles.loadingSubtitle}>Processing turbine data with Monte Carlo simulations…</p>
        <div className={styles.loadingDots}>
          <div className={styles.loadingDot} />
          <div className={styles.loadingDot} />
          <div className={styles.loadingDot} />
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: INPUT PAGE
  // ─────────────────────────────────────────────────────────────

  const renderInputPage = () => (
    <div className={`${styles.inputPage} ${page !== 'input' ? styles.hidden : ''}`}>
      <div className={styles.maxWidth}>

        {/* Hero Header */}
        <div className={styles.heroHeader}>
          <div className={styles.heroIconRing}>
            <Wind size={32} />
          </div>
          <h1 className={styles.heroTitle}>
            Turbine Long-Term{' '}
            <span className={styles.heroTitleAccent}>Gross Energy Analysis</span>
          </h1>
          <p className={styles.heroSubtitle}>
            GAM-based modeling with Monte Carlo uncertainty quantification
          </p>
        </div>

        {/* Config Card */}
        <div className={styles.configCard}>
          <p className={styles.configCardTitle}>
            <Settings size={16} />
            Analysis Configuration
          </p>

          <div className={styles.configGrid}>
            {/* UQ Toggle */}
            <div className={styles.configItem}>
              <label className={styles.configLabel}>
                <div
                  className={styles.checkboxRow}
                  onClick={() => setConfig({ ...config, UQ: !config.UQ })}
                >
                  <div className={`${styles.checkboxCustom} ${config.UQ ? styles.checked : ''}`}>
                    {config.UQ && <CheckCircle size={13} color="white" />}
                  </div>
                  Enable Uncertainty Quantification
                </div>
              </label>
            </div>

            {config.UQ && (
              <div className={styles.configItem}>
                <label className={styles.configLabel}>
                  Number of Simulations
                  <input
                    type="number"
                    min="100"
                    max="20000"
                    step="100"
                    value={config.num_sim}
                    onChange={(e) => setConfig({ ...config, num_sim: parseInt(e.target.value) })}
                    className={styles.configInput}
                  />
                </label>
              </div>
            )}

            <div className={styles.configItem}>
              <label className={styles.configLabel}>
                SCADA Uncertainty (%)
                <input
                  type="number"
                  min="0.001"
                  max="0.02"
                  step="0.001"
                  value={config.uncertainty_scada}
                  onChange={(e) => setConfig({ ...config, uncertainty_scada: parseFloat(e.target.value) })}
                  className={styles.configInput}
                />
              </label>
            </div>

            <div className={styles.configItem}>
              <label className={styles.configLabel}>
                Wind Bin Threshold (σ)
                <div className={styles.rangeInputs}>
                  <input
                    type="number" min="0.5" max="5.0" step="0.1"
                    value={config.wind_bin_threshold_min}
                    onChange={(e) => setConfig({ ...config, wind_bin_threshold_min: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Min"
                  />
                  <span>to</span>
                  <input
                    type="number" min="0.5" max="5.0" step="0.1"
                    value={config.wind_bin_threshold_max}
                    onChange={(e) => setConfig({ ...config, wind_bin_threshold_max: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Max"
                  />
                </div>
              </label>
            </div>

            <div className={styles.configItem}>
              <label className={styles.configLabel}>
                Max Power Filter
                <div className={styles.rangeInputs}>
                  <input
                    type="number" min="0.5" max="1.0" step="0.05"
                    value={config.max_power_filter_min}
                    onChange={(e) => setConfig({ ...config, max_power_filter_min: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Min"
                  />
                  <span>to</span>
                  <input
                    type="number" min="0.5" max="1.0" step="0.05"
                    value={config.max_power_filter_max}
                    onChange={(e) => setConfig({ ...config, max_power_filter_max: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Max"
                  />
                </div>
              </label>
            </div>

            <div className={styles.configItem}>
              <label className={styles.configLabel}>
                Correction Threshold
                <div className={styles.rangeInputs}>
                  <input
                    type="number" min="0.5" max="1.0" step="0.05"
                    value={config.correction_threshold_min}
                    onChange={(e) => setConfig({ ...config, correction_threshold_min: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Min"
                  />
                  <span>to</span>
                  <input
                    type="number" min="0.5" max="1.0" step="0.05"
                    value={config.correction_threshold_max}
                    onChange={(e) => setConfig({ ...config, correction_threshold_max: parseFloat(e.target.value) })}
                    className={styles.configInputSmall}
                    placeholder="Max"
                  />
                </div>
              </label>
            </div>

            <button
              onClick={runAnalysis}
              disabled={isLoading}
              className={styles.runButton}
            >
              {isLoading ? (
                <>
                  <Loader className={styles.spinning} size={20} />
                  Running Analysis...
                </>
              ) : (
                <>
                  <PlayCircle size={20} />
                  Run Analysis
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: RESULTS PAGE
  // ─────────────────────────────────────────────────────────────

  const renderResultsPage = () => (
    <div className={`${styles.resultsPage} ${page !== 'results' ? styles.hidden : styles.visible}`}>
      <div className={styles.maxWidth}>

        {/* Sticky Nav */}
        <div className={styles.resultsNav}>
          <div className={styles.resultsNavLeft}>
            <div className={styles.logoBox}>
              <Wind size={20} />
            </div>
            <div>
              <p className={styles.headerTitle}>Turbine Gross Energy Analysis</p>
              <p className={styles.headerSubtitle}>GAM · Monte Carlo · OpenOA</p>
            </div>
          </div>
          <button className={styles.backButton} onClick={() => setPage('input')}>
            <ArrowLeft size={15} />
            Back to Config
          </button>
        </div>

        {/* KPI Cards */}
        {results && (
          <div className={`${styles.kpiGrid} ${styles.slideUp}`}>
            <div className={`${styles.kpiCard} ${styles.blue}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>Total Gross Energy (P50)</p>
                  <p className={styles.kpiValue}>{results.summary.p50_gwh.toFixed(1)} GWh</p>
                  <p className={styles.kpiSubtext}>Annual average</p>
                </div>
                <Zap className={styles.kpiIcon} size={36} />
              </div>
            </div>

            <div className={`${styles.kpiCard} ${styles.green}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>P90 (Conservative)</p>
                  <p className={styles.kpiValue}>{results.summary.p90_gwh.toFixed(1)} GWh</p>
                  <p className={styles.kpiSubtext}>90% exceedance</p>
                </div>
                <TrendingDown className={styles.kpiIcon} size={36} />
              </div>
            </div>

            <div className={`${styles.kpiCard} ${styles.purple}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>P10 (Optimistic)</p>
                  <p className={styles.kpiValue}>{results.summary.p10_gwh.toFixed(1)} GWh</p>
                  <p className={styles.kpiSubtext}>10% exceedance</p>
                </div>
                <TrendingUp className={styles.kpiIcon} size={36} />
              </div>
            </div>

            <div className={`${styles.kpiCard} ${styles.orange}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>Turbines Analyzed</p>
                  <p className={styles.kpiValue}>{results.summary.num_turbines}</p>
                  <p className={styles.kpiSubtext}>{results.summary.num_simulations} simulations</p>
                </div>
                <Activity className={styles.kpiIcon} size={36} />
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        {results && (
          <div className={`${styles.tabsContainer} ${styles.fadeIn}`}>
            <div className={styles.tabsHeader}>
              <div className={styles.tabsList}>
                {['overview', 'turbines', 'uncertainty', 'monthly'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.tabContent}>
              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className={styles.fadeIn}>
                  {results.plots.gross_energy_distribution && (
                    <div className={styles.section}>
                      <div className={styles.sectionHeader} onClick={() => toggleSection('distribution')}>
                        <h3 className={styles.sectionTitle}>
                          {expandedSections.distribution ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                          Gross Energy Distribution (P10/P50/P90)
                        </h3>
                      </div>
                      {expandedSections.distribution && (
                        <div className={styles.plotContainer}>
                          <img
                            src={`data:image/png;base64,${results.plots.gross_energy_distribution}`}
                            alt="Gross Energy Distribution"
                            className={styles.plotImage}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Turbine-by-Turbine Comparison</h3>
                    <div className={styles.plotContainer}>
                      <img
                        src={`data:image/png;base64,${results.plots.turbine_comparison}`}
                        alt="Turbine Comparison"
                        className={styles.plotImage}
                      />
                    </div>
                  </div>

                  <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>Monthly Gross Energy Heatmap</h3>
                    <div className={styles.plotContainer}>
                      <img
                        src={`data:image/png;base64,${results.plots.monthly_heatmap}`}
                        alt="Monthly Heatmap"
                        className={styles.plotImage}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TURBINES TAB */}
              {activeTab === 'turbines' && (
                <div className={`${styles.turbineGrid} ${styles.fadeIn}`}>
                  <div>
                    <h3 className={styles.sectionTitle}>Select Turbine</h3>
                    <div className={styles.turbineList}>
                      {results.turbine_results.map(turbine => (
                        <div
                          key={turbine.turbine_id}
                          onClick={() => setSelectedTurbine(turbine)}
                          className={`${styles.turbineCard} ${selectedTurbine?.turbine_id === turbine.turbine_id ? styles.selected : ''}`}
                        >
                          <div className={styles.turbineCardHeader}>
                            <span className={styles.turbineName}>{turbine.turbine_name}</span>
                            <StatusBadge status={turbine.status} health={turbine.health_pct} />
                          </div>
                          <div className={styles.turbineMetrics}>
                            <div>Gross: {(turbine.gross_energy_mwh / 1000).toFixed(2)} GWh</div>
                            <div>R²: {turbine.model_r2.toFixed(3)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedTurbine && (
                    <div className={styles.turbineDetails}>
                      <div className={styles.detailsCard}>
                        <div className={styles.detailsHeader}>
                          <h3 className={styles.detailsTitle}>{selectedTurbine.turbine_name}</h3>
                          <StatusBadge status={selectedTurbine.status} health={selectedTurbine.health_pct} />
                        </div>

                        <div className={styles.metricsGrid}>
                          <div className={styles.metricItem}>
                            <p className={styles.metricLabel}>Gross Energy</p>
                            <p className={`${styles.metricValue} ${styles.blue}`}>
                              {(selectedTurbine.gross_energy_mwh / 1000).toFixed(2)} GWh
                            </p>
                          </div>
                          <div className={styles.metricItem}>
                            <p className={styles.metricLabel}>Model R²</p>
                            <p className={`${styles.metricValue} ${styles.green}`}>
                              {selectedTurbine.model_r2.toFixed(3)}
                            </p>
                          </div>
                          <div className={styles.metricItem}>
                            <p className={styles.metricLabel}>Data Flagged</p>
                            <p className={`${styles.metricValue} ${styles.orange}`}>
                              {selectedTurbine.data_flagged_pct.toFixed(1)}%
                            </p>
                          </div>
                          <div className={styles.metricItem}>
                            <p className={styles.metricLabel}>Data Imputed</p>
                            <p className={`${styles.metricValue} ${styles.purple}`}>
                              {selectedTurbine.data_imputed_pct.toFixed(1)}%
                            </p>
                          </div>
                        </div>

                        <div className={styles.healthBox}>
                          <h4 className={styles.healthTitle}>Health Assessment</h4>
                          <div className={styles.healthBar}>
                            <div
                              className={styles.healthFill}
                              style={{
                                width: `${selectedTurbine.health_pct}%`,
                                backgroundColor: getStatusColor(selectedTurbine.status)
                              }}
                            />
                          </div>
                          <p className={styles.healthText}>
                            Overall Health: <strong>{selectedTurbine.health_pct.toFixed(0)}%</strong>
                          </p>
                          <div className={styles.healthDetails}>
                            <div>Model Fit: {(selectedTurbine.model_r2 * 100).toFixed(0)}%</div>
                            <div>Data Quality: {(100 - selectedTurbine.data_flagged_pct).toFixed(0)}%</div>
                            <div>Imputation Impact: {Math.max(0, 100 - selectedTurbine.data_imputed_pct * 2).toFixed(0)}%</div>
                          </div>
                        </div>
                      </div>

                      <div className={styles.chartContainer}>
                        <h4 className={styles.chartTitle}>Data Processing Flow</h4>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={getWaterfallData()}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="category" tick={{ fill: '#64748b' }} />
                            <YAxis tick={{ fill: '#64748b' }} />
                            <Tooltip formatter={(value) => `${Math.abs(value).toFixed(0)} MWh`} />
                            <Bar dataKey="cumulative" fill="#6366f1" radius={[8, 8, 0, 0]}>
                              {getWaterfallData().map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={entry.category.includes('Flagged') ? '#ef4444' : '#6366f1'}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className={styles.chartContainer}>
                        <h4 className={styles.chartTitle}>Power Curve Analysis</h4>
                        <div className={styles.plotContainer}>
                          <img
                            src={`data:image/png;base64,${results.plots.power_curve_example}`}
                            alt="Power Curve"
                            className={styles.plotImage}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* UNCERTAINTY TAB */}
              {activeTab === 'uncertainty' && results.uncertainty && (
                <div className={`${styles.uncertaintySection} ${styles.fadeIn}`}>
                  <h3 className={styles.sectionTitle}>Uncertainty Quantification</h3>

                  <div className={styles.uncertaintyCards}>
                    <div className={`${styles.uncertaintyCard} ${styles.blue}`}>
                      <p className={styles.uncertaintyCardLabel}>P50 (Median)</p>
                      <p className={styles.uncertaintyCardValue}>{results.uncertainty.p50.toFixed(1)} GWh</p>
                      <p className={styles.uncertaintyCardNote}>50% exceedance probability</p>
                    </div>
                    <div className={`${styles.uncertaintyCard} ${styles.purple}`}>
                      <p className={styles.uncertaintyCardLabel}>P90 (Conservative)</p>
                      <p className={styles.uncertaintyCardValue}>{results.uncertainty.p90.toFixed(1)} GWh</p>
                      <p className={styles.uncertaintyCardNote}>90% exceedance probability</p>
                    </div>
                    <div className={`${styles.uncertaintyCard} ${styles.green}`}>
                      <p className={styles.uncertaintyCardLabel}>P10 (Optimistic)</p>
                      <p className={styles.uncertaintyCardValue}>{results.uncertainty.p10.toFixed(1)} GWh</p>
                      <p className={styles.uncertaintyCardNote}>10% exceedance probability</p>
                    </div>
                  </div>

                  <div className={styles.section}>
                    <h4 className={styles.sectionTitle}>Uncertainty Sources</h4>
                    <div className={styles.sourcesList}>
                      {Object.entries(results.uncertainty.sources).map(([key, value]) => (
                        <div key={key} className={styles.sourceItem}>
                          <span className={styles.sourceName}>
                            {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </span>
                          <span className={styles.sourceValue}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={styles.infoBox}>
                    <h4 className={styles.infoBoxTitle}>
                      <AlertTriangle size={18} />
                      Interpretation Guide
                    </h4>
                    <p className={styles.infoBoxContent}>
                      The P90 value ({results.uncertainty.p90.toFixed(1)} GWh) represents a conservative
                      estimate suitable for financial modeling. There's a 90% probability that actual
                      gross energy production will exceed this value. The P50 value represents the
                      expected (median) outcome.
                    </p>
                  </div>
                </div>
              )}

              {/* MONTHLY TAB */}
              {activeTab === 'monthly' && (
                <div className={`${styles.monthlySection} ${styles.fadeIn}`}>
                  <h3 className={styles.sectionTitle}>Monthly Gross Energy Profile</h3>

                  <ResponsiveContainer width="100%" height={400}>
                    <AreaChart data={getMonthlyChartData()}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fill: '#64748b' }} />
                      <YAxis tick={{ fill: '#64748b' }} />
                      <Tooltip
                        formatter={(value) => `${value.toFixed(2)} GWh`}
                        contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px' }}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#6366f1"
                        fill="#c7d2fe"
                        name="Total Gross Energy"
                      />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div className={styles.section}>
                    <h4 className={styles.sectionTitle}>Reanalysis Products Used</h4>
                    <div className={styles.reanalysisList}>
                      {results.reanalysis_products.map(product => (
                        <div key={product} className={styles.reanalysisItem}>
                          <CheckCircle size={14} color="#22c55e" />
                          <span>{product.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <p>Powered by OpenOA Framework | Turbine Long-Term Gross Energy Analysis</p>
          <p>GAM-based modeling with Monte Carlo uncertainty quantification</p>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: ERROR STATE
  // ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.inputPage}>
          <div className={styles.maxWidth}>
            <div className={styles.errorBox}>
              <AlertTriangle size={48} color="#ef4444" />
              <h2>Analysis Failed</h2>
              <p>{error}</p>
              <button onClick={() => { setError(null); setPage('input'); }} className={styles.retryButton}>
                Try Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: ROOT
  // ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.pageWrapper}>
      {isLoading && renderLoadingOverlay()}
      {renderInputPage()}
      {renderResultsPage()}
    </div>
  );
};

export default TurbineGrossEnergy;