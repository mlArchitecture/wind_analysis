import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import {
  Wind, Activity, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle, PlayCircle, Loader, ArrowLeft, ChevronRight,
  Zap, BarChart2, Layers, Settings, Compass, Filter,
  Map, Clock, Sliders,
} from 'lucide-react';
import axios from 'axios';
import styles from './wakeloss.module.css';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const FEATURE_CHIPS = [
  { icon: <Compass size={13} />, label: 'Direction-binned losses' },
  { icon: <Activity size={13} />, label: 'Monte Carlo UQ' },
  { icon: <TrendingDown size={13} />, label: 'Long-term correction' },
  { icon: <Layers size={13} />, label: 'Per-turbine breakdown' },
  { icon: <BarChart2 size={13} />, label: 'Wind speed analysis' },
  { icon: <Map size={13} />, label: 'Freestream detection' },
];

const TABS = ['overview', 'direction', 'wind-speed', 'turbines'];

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────

const WakeLoss = () => {

  // ── Page state ─────────────────────────────────────────────
  const [page, setPage] = useState('input'); // 'input' | 'results'

  // ── Config state ───────────────────────────────────────────
  const [config, setConfig] = useState({
    // Core
    UQ: true,
    num_sim: 100,
    start_date: '',
    end_date: '',
    end_date_lt: '',
    wind_direction_col: 'WMET_HorWdDir',
    wind_direction_data_type: 'scada',
    wind_direction_asset_ids: '',      // comma-separated string
    reanalysis_products: '',           // comma-separated string

    // Freestream detection
    wd_bin_width: 5.0,
    freestream_sector_width_min: 50.0,
    freestream_sector_width_max: 110.0,
    freestream_power_method: 'mean',
    freestream_wind_speed_method: 'mean',

    // Derating
    correct_for_derating: true,
    derating_filter_wind_speed_start_min: 4.0,
    derating_filter_wind_speed_start_max: 5.0,
    max_power_filter_min: 0.92,
    max_power_filter_max: 0.98,
    wind_bin_mad_thresh_min: 4.0,
    wind_bin_mad_thresh_max: 13.0,

    // Heterogeneity
    correct_for_ws_heterogeneity: false,
    ws_speedup_factor_map: '',

    // Long-term correction
    wd_bin_width_LT_corr: 5.0,
    ws_bin_width_LT_corr: 1.0,
    num_years_LT_min: 10,
    num_years_LT_max: 20,
    assume_no_wakes_high_ws_LT_corr: true,
    no_wakes_ws_thresh_LT_corr: 13.0,
    min_ws_bin_lin_reg: 3.0,
    bin_count_thresh_lin_reg: 50,
  });

  // ── Results state ──────────────────────────────────────────
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [openSections, setOpenSections] = useState({
    core: true, freestream: true, derating: false,
    heterogeneity: false, longterm: false,
  });

  // ─────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────

  const set = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  const toggleSection = key =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Build the API payload from UI state
  const buildPayload = () => {
    const parseCSV = str =>
      str.trim() ? str.split(',').map(s => s.trim()).filter(Boolean) : null;

    return {
      UQ: config.UQ,
      num_sim: config.num_sim,
      start_date: config.start_date || null,
      end_date: config.end_date || null,
      end_date_lt: config.end_date_lt || null,
      wind_direction_col: config.wind_direction_col,
      wind_direction_data_type: config.wind_direction_data_type,
      wind_direction_asset_ids: parseCSV(config.wind_direction_asset_ids),
      reanalysis_products: parseCSV(config.reanalysis_products),

      wd_bin_width: config.wd_bin_width,
      freestream_sector_width: config.UQ
        ? [config.freestream_sector_width_min, config.freestream_sector_width_max]
        : config.freestream_sector_width_min,
      freestream_power_method: config.freestream_power_method,
      freestream_wind_speed_method: config.freestream_wind_speed_method,

      correct_for_derating: config.correct_for_derating,
      derating_filter_wind_speed_start: config.UQ
        ? [config.derating_filter_wind_speed_start_min, config.derating_filter_wind_speed_start_max]
        : config.derating_filter_wind_speed_start_min,
      max_power_filter: config.UQ
        ? [config.max_power_filter_min, config.max_power_filter_max]
        : config.max_power_filter_min,
      wind_bin_mad_thresh: config.UQ
        ? [config.wind_bin_mad_thresh_min, config.wind_bin_mad_thresh_max]
        : config.wind_bin_mad_thresh_min,

      correct_for_ws_heterogeneity: config.correct_for_ws_heterogeneity,
      ws_speedup_factor_map: config.ws_speedup_factor_map || null,

      wd_bin_width_LT_corr: config.wd_bin_width_LT_corr,
      ws_bin_width_LT_corr: config.ws_bin_width_LT_corr,
      num_years_LT: config.UQ
        ? [config.num_years_LT_min, config.num_years_LT_max]
        : config.num_years_LT_min,
      assume_no_wakes_high_ws_LT_corr: config.assume_no_wakes_high_ws_LT_corr,
      no_wakes_ws_thresh_LT_corr: config.no_wakes_ws_thresh_LT_corr,
      min_ws_bin_lin_reg: config.min_ws_bin_lin_reg,
      bin_count_thresh_lin_reg: config.bin_count_thresh_lin_reg,
    };
  };

  // ─────────────────────────────────────────────────────────────
  // API CALL
  // ─────────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.post('/run-wake-losses', buildPayload(), {
        headers: { 'Content-Type': 'application/json' },
      });
      setResults(response.data);
      setPage('results');
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────

  const Toggle = ({ value, onChange }) => (
    <div className={styles.toggleRow} onClick={() => onChange(!value)}>
      <div className={`${styles.toggleTrack} ${value ? styles.on : ''}`}>
        <div className={styles.toggleThumb} />
      </div>
      <span className={`${styles.toggleLabel} ${value ? styles.active : ''}`}>
        {value ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  );

  const RangeRow = ({ minKey, maxKey, step = 0.1, min, max }) => (
    <div className={styles.rangeRow}>
      <input
        type="number" step={step} min={min} max={max}
        value={config[minKey]}
        onChange={e => set(minKey, parseFloat(e.target.value))}
        className={styles.configInputSmall}
      />
      <span>—</span>
      <input
        type="number" step={step} min={min} max={max}
        value={config[maxKey]}
        onChange={e => set(maxKey, parseFloat(e.target.value))}
        className={styles.configInputSmall}
      />
    </div>
  );

  const SectionHeader = ({ sectionKey, title, icon, tag }) => (
    <div
      className={styles.configSectionHeader}
      onClick={() => toggleSection(sectionKey)}
    >
      <div className={styles.configSectionLeft}>
        <span className={styles.configSectionIcon}>{icon}</span>
        <h3 className={styles.configSectionTitle}>{title}</h3>
        {tag && <span className={styles.configSectionTag}>{tag}</span>}
      </div>
      <ChevronRight
        size={16}
        className={`${styles.chevron} ${openSections[sectionKey] ? styles.open : ''}`}
      />
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: INPUT PAGE
  // ─────────────────────────────────────────────────────────────

  const renderInputPage = () => (
    <div className={`${styles.inputPage} ${page !== 'input' ? styles.hidden : ''}`}>
      <div className={styles.maxWidth}>

        {/* Hero */}
        <div className={styles.heroHeader}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeDot} />
            OpenOA · Wake Loss Analysis
          </div>
          <div className={styles.heroIconWrap}>
            <div className={styles.heroIconInner}>
              <Wind size={28} />
            </div>
          </div>
          <h1 className={styles.heroTitle}>
            Wind Farm
            <span className={styles.heroTitleAccent}>Wake Loss Estimator</span>
          </h1>
          <p className={styles.heroSubtitle}>
            Serial wake loss estimation from SCADA data with Monte Carlo UQ
            and long-term reanalysis correction — turbine-level and farm-level.
          </p>
        </div>

        {/* Feature chips */}
        <div className={styles.featureStrip}>
          {FEATURE_CHIPS.map((f, i) => (
            <div key={i} className={styles.featureChip}>
              <span className={styles.featureChipIcon}>{f.icon}</span>
              {f.label}
            </div>
          ))}
        </div>

        {/* Config sections */}
        <div className={styles.configShell}>

          {/* ── CORE SETTINGS ─────────────────────────────── */}
          <div className={styles.configSection}>
            <SectionHeader
              sectionKey="core"
              title="Core Settings"
              icon={<Settings size={15} />}
              tag="Required"
            />
            {openSections.core && (
              <div className={styles.configSectionBody}>
                <div className={styles.configGrid}>

                  {/* UQ toggle */}
                  <div className={styles.configItem}>
                    <span className={styles.configLabel}>Uncertainty Quantification (UQ)</span>
                    <Toggle
                      value={config.UQ}
                      onChange={v => set('UQ', v)}
                    />
                  </div>

                  {/* num_sim — only when UQ on */}
                  {config.UQ && (
                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        Simulations
                        <span className={styles.labelHint}>(num_sim)</span>
                      </label>
                      <input
                        type="number" min={10} max={10000} step={50}
                        value={config.num_sim}
                        onChange={e => set('num_sim', parseInt(e.target.value))}
                        className={styles.configInput}
                      />
                    </div>
                  )}

                  {/* wind direction col */}
                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Wind Direction Column
                      <span className={styles.labelHint}>(wind_direction_col)</span>
                    </label>
                    <input
                      type="text"
                      value={config.wind_direction_col}
                      onChange={e => set('wind_direction_col', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                  {/* wind direction data type */}
                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Wind Direction Data Type
                      <span className={styles.labelHint}>(wind_direction_data_type)</span>
                    </label>
                    <select
                      value={config.wind_direction_data_type}
                      onChange={e => set('wind_direction_data_type', e.target.value)}
                      className={styles.configSelect}
                    >
                      <option value="scada">scada</option>
                      <option value="tower">tower</option>
                    </select>
                  </div>

                  {/* asset IDs */}
                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Asset IDs for Wind Direction
                      <span className={styles.labelHint}>(comma-separated, blank = all)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. T01, T02, T03"
                      value={config.wind_direction_asset_ids}
                      onChange={e => set('wind_direction_asset_ids', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                  {/* reanalysis products */}
                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Reanalysis Products
                      <span className={styles.labelHint}>(comma-separated, blank = all)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. merra2, era5"
                      value={config.reanalysis_products}
                      onChange={e => set('reanalysis_products', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                  {/* start/end date */}
                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Start Date
                      <span className={styles.labelHint}>(blank = auto)</span>
                    </label>
                    <input
                      type="date"
                      value={config.start_date}
                      onChange={e => set('start_date', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      End Date
                      <span className={styles.labelHint}>(blank = auto)</span>
                    </label>
                    <input
                      type="date"
                      value={config.end_date}
                      onChange={e => set('end_date', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* ── FREESTREAM DETECTION ──────────────────────── */}
          <div className={styles.configSection}>
            <SectionHeader
              sectionKey="freestream"
              title="Freestream Detection"
              icon={<Compass size={15} />}
              tag="Sector / Binning"
            />
            {openSections.freestream && (
              <div className={styles.configSectionBody}>
                <div className={styles.configGrid}>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      WD Bin Width (°)
                      <span className={styles.labelHint}>(wd_bin_width)</span>
                    </label>
                    <input
                      type="number" min={1} max={30} step={0.5}
                      value={config.wd_bin_width}
                      onChange={e => set('wd_bin_width', parseFloat(e.target.value))}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Freestream Sector Width (°)
                      <span className={styles.labelHint}>
                        {config.UQ ? 'min — max' : 'single value'}
                      </span>
                    </label>
                    {config.UQ
                      ? <RangeRow minKey="freestream_sector_width_min" maxKey="freestream_sector_width_max" step={1} min={10} max={180} />
                      : <input type="number" min={10} max={180} step={1}
                          value={config.freestream_sector_width_min}
                          onChange={e => set('freestream_sector_width_min', parseFloat(e.target.value))}
                          className={styles.configInput} />
                    }
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Freestream Power Method
                      <span className={styles.labelHint}>(freestream_power_method)</span>
                    </label>
                    <select
                      value={config.freestream_power_method}
                      onChange={e => set('freestream_power_method', e.target.value)}
                      className={styles.configSelect}
                    >
                      <option value="mean">mean</option>
                      <option value="median">median</option>
                      <option value="max">max</option>
                    </select>
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Freestream Wind Speed Method
                      <span className={styles.labelHint}>(freestream_wind_speed_method)</span>
                    </label>
                    <select
                      value={config.freestream_wind_speed_method}
                      onChange={e => set('freestream_wind_speed_method', e.target.value)}
                      className={styles.configSelect}
                    >
                      <option value="mean">mean</option>
                      <option value="median">median</option>
                    </select>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* ── DERATING CORRECTION ───────────────────────── */}
          <div className={styles.configSection}>
            <SectionHeader
              sectionKey="derating"
              title="Derating & Curtailment Correction"
              icon={<Filter size={15} />}
              tag="Power Curve Filter"
            />
            {openSections.derating && (
              <div className={styles.configSectionBody}>
                <div className={styles.configGrid}>

                  <div className={styles.configItem}>
                    <span className={styles.configLabel}>Correct for Derating</span>
                    <Toggle
                      value={config.correct_for_derating}
                      onChange={v => set('correct_for_derating', v)}
                    />
                  </div>

                  {config.correct_for_derating && (<>

                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        Derating Filter WS Start (m/s)
                        <span className={styles.labelHint}>
                          {config.UQ ? 'min — max' : 'single'}
                        </span>
                      </label>
                      {config.UQ
                        ? <RangeRow minKey="derating_filter_wind_speed_start_min" maxKey="derating_filter_wind_speed_start_max" step={0.1} min={1} max={15} />
                        : <input type="number" min={1} max={15} step={0.1}
                            value={config.derating_filter_wind_speed_start_min}
                            onChange={e => set('derating_filter_wind_speed_start_min', parseFloat(e.target.value))}
                            className={styles.configInput} />
                      }
                    </div>

                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        Max Power Filter (fraction of rated)
                        <span className={styles.labelHint}>
                          {config.UQ ? 'min — max' : 'single'}
                        </span>
                      </label>
                      {config.UQ
                        ? <RangeRow minKey="max_power_filter_min" maxKey="max_power_filter_max" step={0.01} min={0.5} max={1.0} />
                        : <input type="number" min={0.5} max={1.0} step={0.01}
                            value={config.max_power_filter_min}
                            onChange={e => set('max_power_filter_min', parseFloat(e.target.value))}
                            className={styles.configInput} />
                      }
                    </div>

                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        Wind Bin MAD Threshold
                        <span className={styles.labelHint}>
                          {config.UQ ? 'min — max' : 'single'}
                        </span>
                      </label>
                      {config.UQ
                        ? <RangeRow minKey="wind_bin_mad_thresh_min" maxKey="wind_bin_mad_thresh_max" step={0.5} min={1} max={20} />
                        : <input type="number" min={1} max={20} step={0.5}
                            value={config.wind_bin_mad_thresh_min}
                            onChange={e => set('wind_bin_mad_thresh_min', parseFloat(e.target.value))}
                            className={styles.configInput} />
                      }
                    </div>

                  </>)}
                </div>
              </div>
            )}
          </div>

          {/* ── WIND SPEED HETEROGENEITY ───────────────────── */}
          <div className={styles.configSection}>
            <SectionHeader
              sectionKey="heterogeneity"
              title="Wind Speed Heterogeneity Correction"
              icon={<Sliders size={15} />}
              tag="Optional"
            />
            {openSections.heterogeneity && (
              <div className={styles.configSectionBody}>
                <div className={styles.configGrid}>

                  <div className={styles.configItem}>
                    <span className={styles.configLabel}>Correct for WS Heterogeneity</span>
                    <Toggle
                      value={config.correct_for_ws_heterogeneity}
                      onChange={v => set('correct_for_ws_heterogeneity', v)}
                    />
                  </div>

                  {config.correct_for_ws_heterogeneity && (
                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        Speedup Factor Map
                        <span className={styles.labelHint}>(CSV path or blank)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="/path/to/speedup_map.csv"
                        value={config.ws_speedup_factor_map}
                        onChange={e => set('ws_speedup_factor_map', e.target.value)}
                        className={styles.configInput}
                      />
                    </div>
                  )}

                </div>
                <div className={styles.infoBox} style={{ marginTop: '0.75rem' }}>
                  <p className={styles.infoBoxTitle}><AlertTriangle size={13} /> What this does</p>
                  <p className={styles.infoBoxContent}>
                    Corrects potential power estimates to account for non-uniform freestream wind
                    speeds across the plant using turbine-specific wind speed speedup factors from
                    a user-supplied CSV (columns: "wd" + one per turbine ID).
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── LONG-TERM CORRECTION ─────────────────────── */}
          <div className={styles.configSection}>
            <SectionHeader
              sectionKey="longterm"
              title="Long-Term Reanalysis Correction"
              icon={<Clock size={15} />}
              tag="LT Correction"
            />
            {openSections.longterm && (
              <div className={styles.configSectionBody}>
                <div className={styles.configGrid}>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      End Date (Long-term)
                      <span className={styles.labelHint}>(blank = auto)</span>
                    </label>
                    <input
                      type="date"
                      value={config.end_date_lt}
                      onChange={e => set('end_date_lt', e.target.value)}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      WD Bin Width for LT Corr (°)
                      <span className={styles.labelHint}>(wd_bin_width_LT_corr)</span>
                    </label>
                    <input
                      type="number" min={1} max={30} step={0.5}
                      value={config.wd_bin_width_LT_corr}
                      onChange={e => set('wd_bin_width_LT_corr', parseFloat(e.target.value))}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      WS Bin Width for LT Corr (m/s)
                      <span className={styles.labelHint}>(ws_bin_width_LT_corr)</span>
                    </label>
                    <input
                      type="number" min={0.5} max={5} step={0.5}
                      value={config.ws_bin_width_LT_corr}
                      onChange={e => set('ws_bin_width_LT_corr', parseFloat(e.target.value))}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Num Years LT
                      <span className={styles.labelHint}>
                        {config.UQ ? 'min — max' : 'single'}
                      </span>
                    </label>
                    {config.UQ
                      ? <RangeRow minKey="num_years_LT_min" maxKey="num_years_LT_max" step={1} min={1} max={30} />
                      : <input type="number" min={1} max={30} step={1}
                          value={config.num_years_LT_min}
                          onChange={e => set('num_years_LT_min', parseInt(e.target.value))}
                          className={styles.configInput} />
                    }
                  </div>

                  <div className={styles.configItem}>
                    <span className={styles.configLabel}>Assume No Wakes at High WS</span>
                    <Toggle
                      value={config.assume_no_wakes_high_ws_LT_corr}
                      onChange={v => set('assume_no_wakes_high_ws_LT_corr', v)}
                    />
                  </div>

                  {config.assume_no_wakes_high_ws_LT_corr && (
                    <div className={styles.configItem}>
                      <label className={styles.configLabel}>
                        No-Wake WS Threshold (m/s)
                        <span className={styles.labelHint}>(no_wakes_ws_thresh_LT_corr)</span>
                      </label>
                      <input
                        type="number" min={5} max={25} step={0.5}
                        value={config.no_wakes_ws_thresh_LT_corr}
                        onChange={e => set('no_wakes_ws_thresh_LT_corr', parseFloat(e.target.value))}
                        className={styles.configInput}
                      />
                    </div>
                  )}

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Min WS Bin Lin Reg (m/s)
                      <span className={styles.labelHint}>(min_ws_bin_lin_reg)</span>
                    </label>
                    <input
                      type="number" min={0} max={10} step={0.5}
                      value={config.min_ws_bin_lin_reg}
                      onChange={e => set('min_ws_bin_lin_reg', parseFloat(e.target.value))}
                      className={styles.configInput}
                    />
                  </div>

                  <div className={styles.configItem}>
                    <label className={styles.configLabel}>
                      Bin Count Threshold (lin reg)
                      <span className={styles.labelHint}>(bin_count_thresh_lin_reg)</span>
                    </label>
                    <input
                      type="number" min={5} max={500} step={5}
                      value={config.bin_count_thresh_lin_reg}
                      onChange={e => set('bin_count_thresh_lin_reg', parseInt(e.target.value))}
                      className={styles.configInput}
                    />
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* RUN BUTTON */}
          <div className={styles.runButtonWrap}>
            <button
              onClick={runAnalysis}
              disabled={isLoading}
              className={styles.runButton}
            >
              {isLoading
                ? <><Loader className={styles.spinning} size={20} /> Running Analysis…</>
                : <><PlayCircle size={20} /> Run Wake Loss Analysis</>
              }
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

        {/* Nav */}
        <div className={styles.resultsNav}>
          <div className={styles.navLeft}>
            <div className={styles.navLogoBox}>
              <div className={styles.navLogoInner}>
                <Wind size={18} />
              </div>
            </div>
            <div>
              <p className={styles.navTitle}>Wake Loss Analysis</p>
              <p className={styles.navSubtitle}>OpenOA · SCADA · Reanalysis LT Correction</p>
            </div>
          </div>
          <button className={styles.backButton} onClick={() => setPage('input')}>
            <ArrowLeft size={14} /> Back to Config
          </button>
        </div>

        {results && (<>
          {/* KPI Cards */}
          <div className={`${styles.kpiGrid} ${styles.slideUp}`}>

            <div className={`${styles.kpiCard} ${styles.teal}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>Wake Loss — LT Corrected</p>
                  <p className={`${styles.kpiValue} ${styles.teal}`}>
                    {results.wake_losses_lt_mean != null
                      ? `${(results.wake_losses_lt_mean * 100).toFixed(2)}%`
                      : `${(results.wake_losses_lt * 100).toFixed(2)}%`}
                  </p>
                  <p className={styles.kpiSubtext}>Long-term corrected</p>
                </div>
                <TrendingDown className={styles.kpiIcon} size={36} />
              </div>
            </div>

            <div className={`${styles.kpiCard} ${styles.amber}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>Wake Loss — Period of Record</p>
                  <p className={`${styles.kpiValue} ${styles.amber}`}>
                    {results.wake_losses_por_mean != null
                      ? `${(results.wake_losses_por_mean * 100).toFixed(2)}%`
                      : `${(results.wake_losses_por * 100).toFixed(2)}%`}
                  </p>
                  <p className={styles.kpiSubtext}>Period of record</p>
                </div>
                <Activity className={styles.kpiIcon} size={36} />
              </div>
            </div>

            {results.wake_losses_lt_std != null && (
              <div className={`${styles.kpiCard} ${styles.purple}`}>
                <div className={styles.kpiContent}>
                  <div>
                    <p className={styles.kpiLabel}>LT Wake Loss Std Dev</p>
                    <p className={`${styles.kpiValue} ${styles.purple}`}>
                      {(results.wake_losses_lt_std * 100).toFixed(2)}%
                    </p>
                    <p className={styles.kpiSubtext}>UQ uncertainty</p>
                  </div>
                  <Zap className={styles.kpiIcon} size={36} />
                </div>
              </div>
            )}

            <div className={`${styles.kpiCard} ${styles.green}`}>
              <div className={styles.kpiContent}>
                <div>
                  <p className={styles.kpiLabel}>Farm Efficiency (LT)</p>
                  <p className={`${styles.kpiValue} ${styles.green}`}>
                    {results.wake_losses_lt_mean != null
                      ? `${((1 - results.wake_losses_lt_mean) * 100).toFixed(1)}%`
                      : `${((1 - results.wake_losses_lt) * 100).toFixed(1)}%`}
                  </p>
                  <p className={styles.kpiSubtext}>Wind farm efficiency</p>
                </div>
                <CheckCircle className={styles.kpiIcon} size={36} />
              </div>
            </div>

          </div>

          {/* Tabs */}
          <div className={`${styles.tabsContainer} ${styles.fadeIn}`}>
            <div className={styles.tabsHeader}>
              <div className={styles.tabsList}>
                {TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`${styles.tab} ${activeTab === tab ? styles.active : ''}`}
                  >
                    {tab.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.tabContent}>

              {/* ── OVERVIEW ─────────────────────────────── */}
              {activeTab === 'overview' && (
                <div className={styles.fadeIn}>
                  {results.plots?.wake_losses_by_direction && (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <Compass size={14} /> Wake Losses by Wind Direction (POR + LT)
                      </p>
                      <div className={styles.plotContainer}>
                        <img
                          src={`data:image/png;base64,${results.plots.wake_losses_by_direction}`}
                          alt="Wake Losses by Direction"
                          className={styles.plotImage}
                        />
                      </div>
                    </div>
                  )}
                  {results.plots?.wake_losses_by_wind_speed && (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <Activity size={14} /> Wake Losses by Wind Speed (POR + LT)
                      </p>
                      <div className={styles.plotContainer}>
                        <img
                          src={`data:image/png;base64,${results.plots.wake_losses_by_wind_speed}`}
                          alt="Wake Losses by Wind Speed"
                          className={styles.plotImage}
                        />
                      </div>
                    </div>
                  )}
                  <div className={styles.infoBox}>
                    <p className={styles.infoBoxTitle}><AlertTriangle size={13} /> Interpretation</p>
                    <p className={styles.infoBoxContent}>
                      Long-term (LT) corrected wake losses account for the difference between the
                      wind conditions observed during the period of record and the historical
                      long-term wind climate using reanalysis data. The LT value is the recommended
                      estimate for financial modelling and resource assessments.
                    </p>
                  </div>
                </div>
              )}

              {/* ── DIRECTION ────────────────────────────── */}
              {activeTab === 'direction' && (
                <div className={styles.fadeIn}>
                  {results.plots?.wake_losses_by_direction_detail ? (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <Compass size={14} /> Directional Wake Loss Profile
                      </p>
                      <div className={styles.plotContainer}>
                        <img
                          src={`data:image/png;base64,${results.plots.wake_losses_by_direction_detail}`}
                          alt="Directional Wake Loss"
                          className={styles.plotImage}
                        />
                      </div>
                    </div>
                  ) : (
                    results.wake_losses_lt_wd && (
                      <div className={styles.resultSection}>
                        <p className={styles.resultSectionTitle}>
                          <Compass size={14} /> LT Wake Loss by Wind Direction Bin
                        </p>
                        <ResponsiveContainer width="100%" height={340}>
                          <BarChart
                            data={Array.from({ length: results.wake_losses_lt_wd.length }, (_, i) => ({
                              wd: `${i * 5}°`,
                              lt: (results.wake_losses_lt_wd[i] !== null && !isNaN(results.wake_losses_lt_wd[i]))
                                ? +((1 - results.wake_losses_lt_wd[i]) * 100).toFixed(2) : null,
                              por: (results.wake_losses_por_wd && results.wake_losses_por_wd[i] !== null)
                                ? +((1 - results.wake_losses_por_wd[i]) * 100).toFixed(2) : null,
                            }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(14,210,200,0.08)" />
                            <XAxis dataKey="wd" tick={{ fill: '#4a6580', fontSize: 10 }} interval={5} />
                            <YAxis tick={{ fill: '#4a6580', fontSize: 11 }} unit="%" />
                            <Tooltip
                              contentStyle={{ background: '#0f1e2e', border: '1px solid rgba(14,210,200,0.2)', borderRadius: 8, color: '#e2f0ff', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                              formatter={v => [`${v}%`]}
                            />
                            <Legend />
                            <Bar dataKey="lt"  name="LT Efficiency"  fill="#0ed2c8" radius={[3,3,0,0]} />
                            <Bar dataKey="por" name="POR Efficiency" fill="#a78bfa" radius={[3,3,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* ── WIND SPEED ───────────────────────────── */}
              {activeTab === 'wind-speed' && (
                <div className={styles.fadeIn}>
                  {results.plots?.wake_losses_by_wind_speed_detail ? (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <Activity size={14} /> Wind Speed Wake Loss Profile
                      </p>
                      <div className={styles.plotContainer}>
                        <img
                          src={`data:image/png;base64,${results.plots.wake_losses_by_wind_speed_detail}`}
                          alt="Wind Speed Wake Loss"
                          className={styles.plotImage}
                        />
                      </div>
                    </div>
                  ) : (
                    results.wake_losses_lt_ws && (
                      <div className={styles.resultSection}>
                        <p className={styles.resultSectionTitle}>
                          <Activity size={14} /> LT Wake Loss by Wind Speed Bin
                        </p>
                        <ResponsiveContainer width="100%" height={340}>
                          <AreaChart
                            data={Array.from({ length: results.wake_losses_lt_ws.length }, (_, i) => ({
                              ws: `${i} m/s`,
                              lt: (results.wake_losses_lt_ws[i] !== null && !isNaN(results.wake_losses_lt_ws[i]))
                                ? +((1 - results.wake_losses_lt_ws[i]) * 100).toFixed(2) : null,
                              por: (results.wake_losses_por_ws && results.wake_losses_por_ws[i] !== null)
                                ? +((1 - results.wake_losses_por_ws[i]) * 100).toFixed(2) : null,
                            }))}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(14,210,200,0.08)" />
                            <XAxis dataKey="ws" tick={{ fill: '#4a6580', fontSize: 10 }} interval={2} />
                            <YAxis tick={{ fill: '#4a6580', fontSize: 11 }} unit="%" />
                            <Tooltip
                              contentStyle={{ background: '#0f1e2e', border: '1px solid rgba(14,210,200,0.2)', borderRadius: 8, color: '#e2f0ff', fontFamily: 'JetBrains Mono', fontSize: 12 }}
                              formatter={v => [`${v}%`]}
                            />
                            <Legend />
                            <Area type="monotone" dataKey="lt"  name="LT Efficiency"  stroke="#0ed2c8" fill="rgba(14,210,200,0.1)" strokeWidth={2} />
                            <Area type="monotone" dataKey="por" name="POR Efficiency" stroke="#a78bfa" fill="rgba(167,139,250,0.08)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* ── TURBINES ─────────────────────────────── */}
              {activeTab === 'turbines' && (
                <div className={styles.fadeIn}>
                  {results.turbine_ids && results.turbine_wake_losses_lt_mean && (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <Layers size={14} /> Per-Turbine Wake Loss Summary
                      </p>
                      <table className={styles.turbineTable}>
                        <thead>
                          <tr>
                            <th>Turbine ID</th>
                            <th>LT Wake Loss (%)</th>
                            <th>POR Wake Loss (%)</th>
                            {results.turbine_wake_losses_lt_std && <th>LT Std Dev (%)</th>}
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.turbine_ids.map((id, i) => {
                            const lt  = results.turbine_wake_losses_lt_mean[i];
                            const por = results.turbine_wake_losses_por_mean?.[i];
                            const std = results.turbine_wake_losses_lt_std?.[i];
                            const pct = lt * 100;
                            return (
                              <tr key={id}>
                                <td className={styles.highlight}>{id}</td>
                                <td className={pct > 10 ? styles.warn : pct > 20 ? styles.danger : ''}>
                                  {pct.toFixed(2)}%
                                </td>
                                <td>{por != null ? `${(por * 100).toFixed(2)}%` : '—'}</td>
                                {std != null && <td>{(std * 100).toFixed(2)}%</td>}
                                <td>
                                  <span className={`${styles.badge} ${pct < 5 ? styles.teal : pct < 15 ? styles.amber : styles.rose}`}>
                                    {pct < 5 ? 'Low' : pct < 15 ? 'Moderate' : 'High'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {results.plots?.turbine_comparison && (
                    <div className={styles.resultSection}>
                      <p className={styles.resultSectionTitle}>
                        <BarChart2 size={14} /> Turbine Comparison Plot
                      </p>
                      <div className={styles.plotContainer}>
                        <img
                          src={`data:image/png;base64,${results.plots.turbine_comparison}`}
                          alt="Turbine Comparison"
                          className={styles.plotImage}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </>)}

        <div className={styles.footer}>
          <p>OpenOA Wake Loss Analysis · Serial SCADA-based method</p>
          <p>Monte Carlo UQ · Long-term reanalysis correction</p>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────
  // RENDER: ERROR
  // ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className={styles.pageWrapper}>
        <div className={styles.inputPage}>
          <div className={styles.maxWidth}>
            <div className={styles.errorBox}>
              <AlertTriangle size={48} color="#f43f5e" />
              <h2>Analysis Failed</h2>
              <p>{error}</p>
              <button
                onClick={() => { setError(null); setPage('input'); }}
                className={styles.retryButton}
              >
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
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingCard}>
            <div className={styles.loadingRing} />
            <p className={styles.loadingTitle}>Running Wake Loss Analysis</p>
            <p className={styles.loadingSubtitle}>
              {config.UQ
                ? `Monte Carlo · ${config.num_sim} simulations…`
                : 'Single-pass analysis…'}
            </p>
            <div className={styles.loadingDots}>
              <div className={styles.loadingDot} />
              <div className={styles.loadingDot} />
              <div className={styles.loadingDot} />
            </div>
          </div>
        </div>
      )}
      {renderInputPage()}
      {renderResultsPage()}
    </div>
  );
};

export default WakeLoss;