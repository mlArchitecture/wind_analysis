import "./App.css";
import { useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import MonteCarlo from "./components/montecarlo";
import ElectricalLosses from "./components/electricallosses";
import WakeLoss from "./components/wakeloss";
import TurbineGrossEnergy from "./components/turbinegross";
import StaticYawMisalignment from "./components/staticyaw";
// ─── Icon helpers ────────────────────────────────────────────────
const icons = {
  scada: "⚡",
  meter: "📊",
  asset: "🏭",
  curtail: "✂️",
  reanalysis_era5: "🌍",
  reanalysis_merra2: "🛰️",
  name: "🏷️",
  latitude: "📍",
  longitude: "📍",
  capacity_mw: "⚙️",
  local_tz: "🕐",
};

const fileInputs = [
  { key: "scada", label: "SCADA Data", type: "file", placeholder: null },
  { key: "meter", label: "Meter Data", type: "file", placeholder: null },
  { key: "tower", label: "Tower Data", type: "file", placeholder: null },
  { key: "asset", label: "Asset Data", type: "file", placeholder: null },
  { key: "status", label: "Status Data", type: "file", placeholder: null },
  { key: "curtail", label: "Curtailment Data", type: "file", placeholder: null },
  { key: "reanalysis_era5", label: "Reanalysis ERA5", type: "file", placeholder: null },
  { key: "reanalysis_merra2", label: "Reanalysis MERRA2", type: "file", placeholder: null },
  {
    key: "name",
    label: "Plant Name",
    type: "text",
    placeholder: "e.g. Northgate Wind Farm",
  },
  {
    key: "latitude",
    label: "Latitude",
    type: "number",
    placeholder: "e.g. 52.3731",
  },
  {
    key: "longitude",
    label: "Longitude",
    type: "number",
    placeholder: "e.g. -1.8204",
  },
  {
    key: "capacity_mw",
    label: "Capacity (MW)",
    type: "number",
    placeholder: "e.g. 150",
  },
  {
    key: "local_tz",
    label: "Timezone",
    type: "text",
    placeholder: "e.g. Europe/Paris",
  },
];

const analysisTypes = [
  { name: "Monte Carlo AEP", path: "/montecarlo" },
  { name: "Turbine Gross Energy", path: "/turbinegrossenergy" },
  { name: "Electrical Losses", path: "/electricallosses" },
  { name: "Wake Losses", path: "/wakelosses" },
  { name: "Yaw Misalignment", path: "/yawmisalignment" },
];

// ─── Upload Page Component ───────────────────────────────────────
function UploadPage() {
  const [files, setFiles] = useState({});
  const [metadata, setMetadata] = useState({});
  const [scadaData, setScadaData] = useState([]);

  // ─── Handle Change ────────────────────────────────────────────
  const handleChange = (e, key) => {
    const value = e.target.type === "file"
      ? e.target.files[0]
      : e.target.value;

    if (e.target.type === "file") {
      setFiles((prev) => ({ ...prev, [key]: value }));

      // If SCADA → parse for preview
      
    } else {
      setMetadata((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formDataToSend = new FormData();

    // Append files
    Object.keys(files).forEach((key) => {
      if (files[key]) {
        formDataToSend.append(key, files[key]);
      }
    });

    // Append metadata
    Object.keys(metadata).forEach((key) => {
      formDataToSend.append(key, metadata[key]);
    });

   

    try {
      const response = await axios.post(
        "http://localhost:8000/upload-and-refine",
        formDataToSend,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      console.log("Backend Response:", response.data);
      alert("Upload successful!");
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed");
    }
  };

  const fileCount = fileInputs.filter(
    (i) => i.type === "file" && files[i.key],
  ).length;

  const totalFiles = fileInputs.filter((i) => i.type === "file").length;

  return (
    <main className="main">
      <div className="page-header">
        <h1>
          Data <span>Configuration</span>
        </h1>
        <p>Upload datasets &amp; plant parameters to begin</p>
      </div>

      <form className="upload-form" onSubmit={handleSubmit}>
        {/* File Inputs */}
        <div>
          <div className="section-label">Input Datasets</div>
          <div className="file-grid">
            {fileInputs
              .filter((i) => i.type === "file")
              .map(({ key, label }) => (
                <div
                  className={`file-card${files[key] ? " has-file" : ""}`}
                  key={key}
                >
                  <div className="card-header">
                    <div className="card-icon">{icons[key]}</div>
                    <label className="file-label" htmlFor={key}>
                      {label}
                    </label>
                  </div>

                  <div className="file-input-zone">
                    <input
                      id={key}
                      type="file"
                      accept=".csv"
                      onChange={(e) => handleChange(e, key)}
                    />
                    <div className="drop-zone">
                      <span className="drop-zone-icon">
                        {files[key] ? "✓" : "↑"}
                      </span>
                      {files[key] ? "File selected" : "Click or drop .csv"}
                    </div>
                  </div>

                  {files[key] && (
                    <div className="file-name">
                      <span className="check-icon">✓</span>
                      {files[key].name}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* Metadata Inputs */}
        <div>
          <div className="section-label">Plant Parameters</div>
          <div className="file-grid">
            {fileInputs
              .filter((i) => i.type !== "file")
              .map(({ key, label, type, placeholder }) => (
                <div className="file-card" key={key}>
                  <div className="card-header">
                    <div className="card-icon">{icons[key]}</div>
                    <label className="file-label" htmlFor={key}>
                      {label}
                    </label>
                  </div>
                  <input
                    id={key}
                    type={type}
                    className="file-input"
                    placeholder={placeholder}
                    onChange={(e) => handleChange(e, key)}
                    step={type === "number" ? "any" : undefined}
                  />
                </div>
              ))}
          </div>
        </div>

        <div className="submit-row">
          <p className="submit-info">
            <span>
              {fileCount}/{totalFiles}
            </span>{" "}
            datasets loaded
          </p>
          <button type="submit" className="submit-btn">
            <span>Submit Configuration</span>
          </button>
        </div>
      </form>
    </main>
  );
}




// ─── Main App Component with Navbar & Routes ─────────────────────
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // ─── Handle Run Analysis Button ──────────────────────────────
  const handleRunAnalysis = () => {
    if (!selectedAnalysis) {
      alert("Please select an analysis type first!");
      return;
    }

    // Navigate to the selected analysis page
    navigate(selectedAnalysis.path);
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">OpenOA Platform</div>

        <div className="nav-actions">
          <div className="dropdown">
            <button
              className="dropdown-toggle"
              onClick={() => setDropdownOpen((p) => !p)}
            >
              {selectedAnalysis?.name ?? "Analysis Type"} ▾
            </button>

            {dropdownOpen && (
              <ul className="dropdown-menu">
                {analysisTypes.map((type) => (
                  <li
                    key={type.name}
                    onClick={() => {
                      setSelectedAnalysis(type);
                      setDropdownOpen(false);
                    }}
                  >
                    {type.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button 
            className="nav-btn" 
            type="button"
            onClick={handleRunAnalysis}
          >
            Run Analysis
          </button>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/montecarlo" element={<MonteCarlo />} />
        <Route path="/turbinegrossenergy" element={<TurbineGrossEnergy />} />
        <Route path="/electricallosses" element={<ElectricalLosses />} />
        <Route path="/wakelosses" element={<WakeLoss />} />
        <Route path="/yawmisalignment" element={<StaticYawMisalignment />} />
      </Routes>
    </div>
  );
}