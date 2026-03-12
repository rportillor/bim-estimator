import { useState, useMemo, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid, LineChart, Line } from "recharts";

// ═══════════════════════════════════════════════════════════════
// ESTIMATORPRO v3 — Report Dashboard
// Professional QS Report Viewer — All 7 Report Types
// ═══════════════════════════════════════════════════════════════

// ── Color Palette ──────────────────────────────────────────────
const C = {
  bg: "#0C0F14", bgCard: "#141820", bgHover: "#1A1F2A",
  border: "#252B38", borderLight: "#2F3749",
  text: "#E8EBF0", textMuted: "#8B93A5", textDim: "#5C6478",
  accent: "#4F8CFF", accentDark: "#3A6CD4",
  green: "#34D399", greenDark: "#065F46",
  red: "#F87171", redDark: "#7F1D1D",
  amber: "#FBBF24", amberDark: "#78350F",
  purple: "#A78BFA",
  cyan: "#22D3EE",
  division: ["#4F8CFF","#34D399","#FBBF24","#F87171","#A78BFA","#22D3EE","#F472B6","#FB923C","#818CF8","#2DD4BF","#E879F9","#FCD34D"],
};

const SEVERITY_COLOR = { CRITICAL: C.red, HIGH: "#FB923C", MEDIUM: C.amber, LOW: C.cyan, INFORMATIONAL: C.textDim, GAP: C.red };
const CONFIDENCE_COLOR = { HIGH: C.green, MEDIUM: C.amber, LOW: "#FB923C", GAP: C.red };

// ── Demo Data ──────────────────────────────────────────────────
const DEMO_BOQ = {
  metadata: { reportId: "RPT-2026-001", projectName: "The Moorings on Cameron Lake", generatedAt: "2026-03-01T22:34:00Z", standards: ["CIQS Standard Method", "CSI MasterFormat 2018", "AACE 18R-97", "RICS NRM1/NRM2"] },
  divisionSubtotals: [
    { division: "03", title: "Concrete", materialCost: 42500, labourCost: 38200, equipmentCost: 12800, totalCost: 93500, lineCount: 8 },
    { division: "05", title: "Metals", materialCost: 35600, labourCost: 24900, equipmentCost: 10700, totalCost: 71200, lineCount: 4 },
    { division: "06", title: "Wood & Composites", materialCost: 15960, labourCost: 14160, equipmentCost: 1770, totalCost: 31890, lineCount: 3 },
    { division: "07", title: "Thermal & Moisture", materialCost: 5824, labourCost: 6552, equipmentCost: 1456, totalCost: 13832, lineCount: 2 },
    { division: "08", title: "Openings", materialCost: 33240, labourCost: 18120, equipmentCost: 6040, totalCost: 57400, lineCount: 5 },
    { division: "09", title: "Finishes", materialCost: 26180, labourCost: 41100, equipmentCost: 7480, totalCost: 74760, lineCount: 6 },
    { division: "21", title: "Fire Suppression", materialCost: 4032, labourCost: 5040, equipmentCost: 1008, totalCost: 10080, lineCount: 1 },
    { division: "22", title: "Plumbing", materialCost: 20480, labourCost: 23040, equipmentCost: 5120, totalCost: 48640, lineCount: 3 },
    { division: "23", title: "HVAC", materialCost: 9180, labourCost: 8160, equipmentCost: 3060, totalCost: 20400, lineCount: 2 },
    { division: "26", title: "Electrical", materialCost: 16128, labourCost: 20160, equipmentCost: 4032, totalCost: 40320, lineCount: 4 },
    { division: "31", title: "Earthwork", materialCost: 4590, labourCost: 5355, equipmentCost: 5355, totalCost: 15300, lineCount: 1 },
  ],
  storeySubtotals: [
    { storey: "Foundation", materialCost: 4590, labourCost: 5355, equipmentCost: 5355, totalCost: 15300, lineCount: 1 },
    { storey: "Level 1", materialCost: 162420, labourCost: 155280, equipmentCost: 44100, totalCost: 361800, lineCount: 28 },
    { storey: "Level 2", materialCost: 46704, labourCost: 44092, equipmentCost: 9326, totalCost: 100222, lineCount: 10 },
  ],
  tradePackageSubtotals: [
    { tradePackage: "Concrete", totalCost: 93500, lineCount: 8 },
    { tradePackage: "Finishes", totalCost: 74760, lineCount: 6 },
    { tradePackage: "Structural Steel & Rebar", totalCost: 71200, lineCount: 4 },
    { tradePackage: "Doors, Windows & Glazing", totalCost: 57400, lineCount: 5 },
    { tradePackage: "Plumbing", totalCost: 48640, lineCount: 3 },
    { tradePackage: "Electrical", totalCost: 40320, lineCount: 4 },
    { tradePackage: "Carpentry", totalCost: 31890, lineCount: 3 },
    { tradePackage: "Mechanical / HVAC", totalCost: 20400, lineCount: 2 },
    { tradePackage: "Site Work", totalCost: 15300, lineCount: 1 },
    { tradePackage: "Roofing & Waterproofing", totalCost: 13832, lineCount: 2 },
    { tradePackage: "Fire Protection", totalCost: 10080, lineCount: 1 },
  ],
  directCost: 477322,
  overheadAmount: 47732, profitAmount: 38186, contingencyAmount: 56324, taxAmount: 80543,
  totalProjectCost: 700107,
  overheadRate: 0.10, profitRate: 0.08, contingencyRate: 0.10, taxRate: 0.13,
  regionalFactor: 1.05, regionName: "Fenelon Falls, ON",
  confidenceSummary: { highCount: 28, mediumCount: 7, lowCount: 3, gapCount: 2, overallConfidence: 78 },
  gapWarnings: ["2 line item(s) have NO document evidence — flagged as GAP.", "3 line item(s) have LOW confidence (zero qty or rate)."],
  lines: Array.from({ length: 39 }, (_, i) => ({
    lineNo: i + 1, csiDivision: ["03","05","06","07","08","09","21","22","23","26","31"][i % 11],
    description: ["Concrete slab","Rebar","Wood framing","Insulation","Doors","Drywall","Sprinklers","Plumbing","Ductwork","Lighting","Excavation"][i % 11],
    unit: ["m³","kg","m","m²","ea","m²","ea","ea","m","ea","m³"][i % 11],
    quantity: [45.6,12500,380,520,24,890,36,16,240,48,850][i % 11],
    totalCost: [13640,35625,15960,14560,20400,33820,10080,51200,20400,15360,15300][i % 11],
    storey: i < 28 ? "Level 1" : i < 38 ? "Level 2" : "Foundation",
    tradePackage: ["Concrete","Structural Steel & Rebar","Carpentry","Roofing & Waterproofing","Doors, Windows & Glazing","Finishes","Fire Protection","Plumbing","Mechanical / HVAC","Electrical","Site Work"][i % 11],
    confidenceLevel: i < 28 ? "HIGH" : i < 35 ? "MEDIUM" : i < 37 ? "LOW" : "GAP",
    hasEvidence: i < 37,
  })),
};

const DEMO_CLASH = {
  summary: { totalClashes: 14, criticalCount: 2, highCount: 4, mediumCount: 5, lowCount: 2, informationalCount: 1, unresolvedCount: 14, rfisRequired: 3, estimatedReworkCost: 98500, estimatedReworkDays: 18 },
  clashes: [
    { clashId: "CLH-001", severity: "CRITICAL", category: "HARD_CLASH", elementA: "duct-001", elementB: "beam-004", location: "Grid B-3", storey: "Level 1", penetrationDepth_mm: 120, description: "HVAC supply duct penetrates concrete beam", recommendation: "Lower duct routing below beam soffit" },
    { clashId: "CLH-002", severity: "CRITICAL", category: "HARD_CLASH", elementA: "pipe-003", elementB: "col-002", location: "Grid D-1", storey: "Level 1", penetrationDepth_mm: 85, description: "Sanitary pipe intersects column", recommendation: "Reroute pipe around column" },
    { clashId: "CLH-003", severity: "HIGH", category: "CLEARANCE", elementA: "duct-002", elementB: "pipe-001", location: "Grid C-4", storey: "Level 1", penetrationDepth_mm: 45, description: "Insufficient clearance between supply duct and cold water pipe", recommendation: "Raise duct 100mm" },
    { clashId: "CLH-004", severity: "HIGH", category: "CLEARANCE", elementA: "conduit-005", elementB: "spr-003", location: "Grid A-2", storey: "Level 2", penetrationDepth_mm: 30, description: "Conduit interferes with sprinkler drop", recommendation: "Relocate conduit routing" },
    { clashId: "CLH-005", severity: "MEDIUM", category: "SOFT_CLASH", elementA: "wall-012", elementB: "duct-004", location: "Grid E-5", storey: "Level 1", penetrationDepth_mm: 20, description: "Partition wall conflicts with return air duct zone", recommendation: "Coordinate wall/duct layout" },
  ],
};

const DEMO_EXEC = {
  projectOverview: { projectName: "The Moorings on Cameron Lake", location: "Fenelon Falls, ON", buildingType: "Residential", grossFloorArea_m2: 850, storeyCount: 3, constructionType: "Wood Frame + Concrete" },
  costSummary: { directCost: 477322, indirectCost: 85918, contingency: 56324, taxes: 80543, totalProjectCost: 700107, costPerM2: 824, costPerSF: 77 },
  confidenceAnalysis: { estimateClass: "Class 3 (Budget Authorization)", accuracyRange: { low: -10, high: 20 }, monteCarloP10: 623000, monteCarloP50: 700107, monteCarloP90: 812000, simulationRuns: 10000, dataCompleteness: 78 },
  riskSummary: { totalGaps: 5, criticalGaps: 2, rfisRequired: 3, clashesFound: 14, criticalClashes: 2, constructabilityIssues: 4 },
  recommendations: [
    "Resolve 5 data gap(s) via RFI to improve estimate reliability.",
    "Address 2 critical clash(es) before construction to avoid rework.",
    "Review 4 constructability issue(s) with the design team.",
  ],
  keyAssumptions: ["Regional cost factor: 1.05 (Fenelon Falls, ON)", "OH&P: Overhead 10.0%, Profit 8.0%", "Contingency: 10.0%", "Tax: 13.0% (Ontario HST)"],
  exclusions: ["Land acquisition and legal fees", "FF&E unless noted", "Owner's PM costs", "Financing and insurance", "Permits and development charges"],
};

const DEMO_MC = [
  { x: 560000, y: 2 }, { x: 580000, y: 5 }, { x: 600000, y: 12 }, { x: 620000, y: 28 },
  { x: 640000, y: 55 }, { x: 660000, y: 95 }, { x: 680000, y: 140 }, { x: 700000, y: 165 },
  { x: 720000, y: 142 }, { x: 740000, y: 110 }, { x: 760000, y: 72 }, { x: 780000, y: 40 },
  { x: 800000, y: 18 }, { x: 820000, y: 8 }, { x: 840000, y: 3 },
];

// ── Formatting Helpers ─────────────────────────────────────────
const fmt = (n) => "$" + Math.round(n).toLocaleString("en-CA");
const fmtK = (n) => n >= 1000000 ? "$" + (n / 1000000).toFixed(1) + "M" : n >= 1000 ? "$" + (n / 1000).toFixed(0) + "K" : "$" + n;

// ── Reusable Components ────────────────────────────────────────
const Badge = ({ label, color }) => (
  <span style={{ background: color + "22", color, padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>{label}</span>
);

const StatCard = ({ label, value, sub, accent = C.accent }) => (
  <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 20px", flex: 1, minWidth: 140 }}>
    <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{sub}</div>}
  </div>
);

const SectionTitle = ({ children, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, marginTop: 28 }}>
    <span style={{ fontSize: 18 }}>{icon}</span>
    <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0, letterSpacing: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>{children}</h3>
    <div style={{ flex: 1, height: 1, background: C.border }} />
  </div>
);

const TabButton = ({ label, active, onClick, count }) => (
  <button onClick={onClick} style={{
    background: active ? C.accent + "18" : "transparent", color: active ? C.accent : C.textMuted,
    border: `1px solid ${active ? C.accent + "44" : "transparent"}`, borderRadius: 6,
    padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
    display: "flex", alignItems: "center", gap: 8, fontFamily: "'JetBrains Mono', monospace",
  }}>
    {label}
    {count !== undefined && <span style={{ background: active ? C.accent + "33" : C.border, padding: "1px 7px", borderRadius: 10, fontSize: 10 }}>{count}</span>}
  </button>
);

// ── Main Component ─────────────────────────────────────────────
export default function ReportDashboard() {
  const [activeTab, setActiveTab] = useState("executive");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [storeyFilter, setStoreyFilter] = useState("all");

  const filteredLines = useMemo(() => {
    return DEMO_BOQ.lines.filter(l => {
      if (divisionFilter !== "all" && l.csiDivision !== divisionFilter) return false;
      if (storeyFilter !== "all" && l.storey !== storeyFilter) return false;
      return true;
    });
  }, [divisionFilter, storeyFilter]);

  const confidenceData = [
    { name: "HIGH", value: DEMO_BOQ.confidenceSummary.highCount, color: C.green },
    { name: "MEDIUM", value: DEMO_BOQ.confidenceSummary.mediumCount, color: C.amber },
    { name: "LOW", value: DEMO_BOQ.confidenceSummary.lowCount, color: "#FB923C" },
    { name: "GAP", value: DEMO_BOQ.confidenceSummary.gapCount, color: C.red },
  ];

  const costBreakdownData = [
    { name: "Material", value: DEMO_BOQ.divisionSubtotals.reduce((s, d) => s + d.materialCost, 0), color: C.accent },
    { name: "Labour", value: DEMO_BOQ.divisionSubtotals.reduce((s, d) => s + d.labourCost, 0), color: C.green },
    { name: "Equipment", value: DEMO_BOQ.divisionSubtotals.reduce((s, d) => s + d.equipmentCost, 0), color: C.amber },
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(135deg, #0C0F14 0%, #141820 50%, #0C0F14 100%)", borderBottom: `1px solid ${C.border}`, padding: "20px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1400, margin: "0 auto" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}66` }} />
              <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1.5 }}>ESTIMATORPRO v3 — REPORT DASHBOARD</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: C.text }}>{DEMO_BOQ.metadata.projectName}</h1>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{DEMO_BOQ.regionName} · Generated {new Date(DEMO_BOQ.metadata.generatedAt).toLocaleDateString()}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {DEMO_BOQ.metadata.standards.map((s, i) => <Badge key={i} label={s} color={[C.accent, C.green, C.amber, C.purple][i]} />)}
          </div>
        </div>
      </div>

      {/* ── Navigation Tabs ────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "12px 32px", background: C.bgCard }}>
        <div style={{ display: "flex", gap: 4, maxWidth: 1400, margin: "0 auto", flexWrap: "wrap" }}>
          <TabButton label="Executive Summary" active={activeTab === "executive"} onClick={() => setActiveTab("executive")} />
          <TabButton label="BOQ Detail" active={activeTab === "boq"} onClick={() => setActiveTab("boq")} count={DEMO_BOQ.lines.length} />
          <TabButton label="Cost Analysis" active={activeTab === "cost"} onClick={() => setActiveTab("cost")} />
          <TabButton label="Clash Detection" active={activeTab === "clash"} onClick={() => setActiveTab("clash")} count={DEMO_CLASH.summary.totalClashes} />
          <TabButton label="Confidence" active={activeTab === "confidence"} onClick={() => setActiveTab("confidence")} />
          <TabButton label="Trade Packages" active={activeTab === "trades"} onClick={() => setActiveTab("trades")} count={DEMO_BOQ.tradePackageSubtotals.length} />
          <TabButton label="Risk & Gaps" active={activeTab === "risk"} onClick={() => setActiveTab("risk")} count={DEMO_EXEC.riskSummary.totalGaps} />
        </div>
      </div>

      {/* ── Content ────────────────────────────────────── */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 32px" }}>

        {/* ═══ EXECUTIVE SUMMARY ═══ */}
        {activeTab === "executive" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard label="Total Project Cost" value={fmt(DEMO_EXEC.costSummary.totalProjectCost)} sub={`${DEMO_EXEC.confidenceAnalysis.accuracyRange.low}% to +${DEMO_EXEC.confidenceAnalysis.accuracyRange.high}% accuracy`} accent={C.accent} />
              <StatCard label="Cost / m²" value={fmt(DEMO_EXEC.costSummary.costPerM2)} sub={`${DEMO_EXEC.projectOverview.grossFloorArea_m2} m² GFA`} accent={C.green} />
              <StatCard label="Cost / SF" value={fmt(DEMO_EXEC.costSummary.costPerSF)} sub="Imperial equivalent" accent={C.green} />
              <StatCard label="Confidence" value={`${DEMO_EXEC.confidenceAnalysis.dataCompleteness}%`} sub={DEMO_EXEC.confidenceAnalysis.estimateClass} accent={DEMO_EXEC.confidenceAnalysis.dataCompleteness >= 70 ? C.green : C.amber} />
              <StatCard label="Clashes" value={DEMO_EXEC.riskSummary.clashesFound} sub={`${DEMO_EXEC.riskSummary.criticalClashes} critical`} accent={DEMO_EXEC.riskSummary.criticalClashes > 0 ? C.red : C.green} />
            </div>

            <SectionTitle icon="💰">Cost Breakdown</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>COST ROLL-UP</div>
                {[
                  ["Direct Cost", DEMO_EXEC.costSummary.directCost, C.accent],
                  ["Overhead + Profit", DEMO_EXEC.costSummary.indirectCost, C.purple],
                  ["Contingency", DEMO_EXEC.costSummary.contingency, C.amber],
                  ["Taxes (HST 13%)", DEMO_EXEC.costSummary.taxes, C.textMuted],
                ].map(([label, val, color], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.textMuted, fontSize: 13 }}>{label}</span>
                    <span style={{ color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{fmt(val)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", marginTop: 4 }}>
                  <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>TOTAL PROJECT COST</span>
                  <span style={{ color: C.accent, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 18 }}>{fmt(DEMO_EXEC.costSummary.totalProjectCost)}</span>
                </div>
              </div>

              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>MONTE CARLO SIMULATION ({DEMO_EXEC.confidenceAnalysis.simulationRuns?.toLocaleString()} runs)</div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={DEMO_MC}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="x" tick={{ fill: C.textDim, fontSize: 10 }} tickFormatter={fmtK} />
                    <YAxis tick={{ fill: C.textDim, fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12 }} formatter={(v) => [v, "Frequency"]} labelFormatter={fmtK} />
                    <Line type="monotone" dataKey="y" stroke={C.accent} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 8 }}>
                  {[["P10", DEMO_EXEC.confidenceAnalysis.monteCarloP10, C.green], ["P50", DEMO_EXEC.confidenceAnalysis.monteCarloP50, C.accent], ["P90", DEMO_EXEC.confidenceAnalysis.monteCarloP90, C.red]].map(([label, val, col]) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ color: C.textDim }}>{label}</div>
                      <div style={{ color: col, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 13 }}>{fmt(val)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <SectionTitle icon="📋">Recommendations</SectionTitle>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
              {DEMO_EXEC.recommendations.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < DEMO_EXEC.recommendations.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ color: C.amber, fontSize: 14, flexShrink: 0 }}>⚠</span>
                  <span style={{ fontSize: 13, color: C.textMuted }}>{r}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>KEY ASSUMPTIONS</div>
                {DEMO_EXEC.keyAssumptions.map((a, i) => <div key={i} style={{ fontSize: 12, color: C.textDim, padding: "4px 0" }}>• {a}</div>)}
              </div>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>EXCLUSIONS</div>
                {DEMO_EXEC.exclusions.map((e, i) => <div key={i} style={{ fontSize: 12, color: C.textDim, padding: "4px 0" }}>• {e}</div>)}
              </div>
            </div>
          </div>
        )}

        {/* ═══ BOQ DETAIL ═══ */}
        {activeTab === "boq" && (
          <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <select value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)}
                style={{ background: C.bgCard, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 12 }}>
                <option value="all">All Divisions</option>
                {DEMO_BOQ.divisionSubtotals.map(d => <option key={d.division} value={d.division}>Div {d.division} — {d.title}</option>)}
              </select>
              <select value={storeyFilter} onChange={e => setStoreyFilter(e.target.value)}
                style={{ background: C.bgCard, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 12 }}>
                <option value="all">All Storeys</option>
                {DEMO_BOQ.storeySubtotals.map(s => <option key={s.storey} value={s.storey}>{s.storey}</option>)}
              </select>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: C.textMuted, alignSelf: "center" }}>{filteredLines.length} items shown</div>
            </div>

            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                      {["#", "CSI", "Description", "Unit", "Qty", "Total Cost", "Storey", "Trade", "Conf."].map(h => (
                        <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: C.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLines.slice(0, 25).map((l, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: l.confidenceLevel === "GAP" ? C.redDark + "22" : "transparent" }}>
                        <td style={{ padding: "8px 12px", color: C.textDim }}>{l.lineNo}</td>
                        <td style={{ padding: "8px 12px" }}>{l.csiDivision}</td>
                        <td style={{ padding: "8px 12px", color: C.text }}>{l.description}</td>
                        <td style={{ padding: "8px 12px", color: C.textMuted }}>{l.unit}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>{l.quantity.toLocaleString()}</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: C.accent }}>{fmt(l.totalCost)}</td>
                        <td style={{ padding: "8px 12px", color: C.textMuted }}>{l.storey}</td>
                        <td style={{ padding: "8px 12px", color: C.textDim, fontSize: 11 }}>{l.tradePackage}</td>
                        <td style={{ padding: "8px 12px" }}><Badge label={l.confidenceLevel} color={CONFIDENCE_COLOR[l.confidenceLevel]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredLines.length > 25 && <div style={{ padding: 12, textAlign: "center", color: C.textDim, fontSize: 11 }}>Showing 25 of {filteredLines.length} items</div>}
            </div>
          </div>
        )}

        {/* ═══ COST ANALYSIS ═══ */}
        {activeTab === "cost" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label="Direct Cost" value={fmt(DEMO_BOQ.directCost)} accent={C.accent} />
              <StatCard label="Overhead" value={fmt(DEMO_BOQ.overheadAmount)} sub={`${(DEMO_BOQ.overheadRate * 100).toFixed(0)}%`} accent={C.purple} />
              <StatCard label="Profit" value={fmt(DEMO_BOQ.profitAmount)} sub={`${(DEMO_BOQ.profitRate * 100).toFixed(0)}%`} accent={C.green} />
              <StatCard label="Contingency" value={fmt(DEMO_BOQ.contingencyAmount)} sub={`${(DEMO_BOQ.contingencyRate * 100).toFixed(0)}%`} accent={C.amber} />
            </div>

            <SectionTitle icon="📊">Cost by CSI Division</SectionTitle>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={DEMO_BOQ.divisionSubtotals} layout="vertical" margin={{ left: 120 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis type="number" tick={{ fill: C.textDim, fontSize: 10 }} tickFormatter={fmtK} />
                  <YAxis type="category" dataKey="title" tick={{ fill: C.textMuted, fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6 }} formatter={(v) => [fmt(v)]} />
                  <Bar dataKey="materialCost" name="Material" stackId="a" fill={C.accent} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="labourCost" name="Labour" stackId="a" fill={C.green} />
                  <Bar dataKey="equipmentCost" name="Equipment" stackId="a" fill={C.amber} radius={[0, 4, 4, 0]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <SectionTitle icon="🏢">Cost by Storey</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={DEMO_BOQ.storeySubtotals}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="storey" tick={{ fill: C.textMuted, fontSize: 11 }} />
                    <YAxis tick={{ fill: C.textDim, fontSize: 10 }} tickFormatter={fmtK} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6 }} formatter={(v) => [fmt(v)]} />
                    <Bar dataKey="totalCost" fill={C.accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>M / L / E SPLIT</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={costBreakdownData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                      {costBreakdownData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6 }} formatter={(v) => [fmt(v)]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ═══ CLASH DETECTION ═══ */}
        {activeTab === "clash" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label="Total Clashes" value={DEMO_CLASH.summary.totalClashes} accent={C.accent} />
              <StatCard label="Critical" value={DEMO_CLASH.summary.criticalCount} accent={C.red} />
              <StatCard label="High" value={DEMO_CLASH.summary.highCount} accent="#FB923C" />
              <StatCard label="RFIs Required" value={DEMO_CLASH.summary.rfisRequired} accent={C.amber} />
              <StatCard label="Est. Rework Cost" value={fmt(DEMO_CLASH.summary.estimatedReworkCost)} sub={`${DEMO_CLASH.summary.estimatedReworkDays} days`} accent={C.red} />
            </div>

            <SectionTitle icon="⚡">Clash Register</SectionTitle>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              {DEMO_CLASH.clashes.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 100px 1fr 120px", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${C.border}`, alignItems: "center",
                  background: c.severity === "CRITICAL" ? C.redDark + "18" : "transparent" }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: C.textDim }}>{c.clashId}</div>
                  <Badge label={c.severity} color={SEVERITY_COLOR[c.severity]} />
                  <div>
                    <div style={{ fontSize: 13, color: C.text }}>{c.description}</div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>{c.location} · {c.storey} · {c.penetrationDepth_mm}mm penetration</div>
                  </div>
                  <div style={{ fontSize: 11, color: C.cyan }}>{c.recommendation}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ CONFIDENCE ═══ */}
        {activeTab === "confidence" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label="Overall Confidence" value={`${DEMO_BOQ.confidenceSummary.overallConfidence}%`} accent={DEMO_BOQ.confidenceSummary.overallConfidence >= 70 ? C.green : C.amber} />
              <StatCard label="HIGH" value={DEMO_BOQ.confidenceSummary.highCount} accent={C.green} />
              <StatCard label="MEDIUM" value={DEMO_BOQ.confidenceSummary.mediumCount} accent={C.amber} />
              <StatCard label="LOW" value={DEMO_BOQ.confidenceSummary.lowCount} accent="#FB923C" />
              <StatCard label="GAP (No Evidence)" value={DEMO_BOQ.confidenceSummary.gapCount} accent={C.red} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>CONFIDENCE DISTRIBUTION</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={confidenceData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                      {confidenceData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontFamily: "'JetBrains Mono', monospace" }}>CONFIDENCE GAUGE</div>
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ width: 140, height: 140, borderRadius: "50%", border: `8px solid ${C.border}`, margin: "0 auto", position: "relative",
                    background: `conic-gradient(${C.green} ${DEMO_BOQ.confidenceSummary.overallConfidence * 3.6}deg, ${C.border} 0)` }}>
                    <div style={{ position: "absolute", inset: 12, borderRadius: "50%", background: C.bgCard, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
                      <div style={{ fontSize: 32, fontWeight: 700, color: C.green, fontFamily: "'JetBrains Mono', monospace" }}>{DEMO_BOQ.confidenceSummary.overallConfidence}</div>
                      <div style={{ fontSize: 10, color: C.textDim }}>PERCENT</div>
                    </div>
                  </div>
                </div>
                {DEMO_BOQ.gapWarnings.map((w, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", fontSize: 12, color: C.amber }}>
                    <span>⚠</span><span style={{ color: C.textMuted }}>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ TRADE PACKAGES ═══ */}
        {activeTab === "trades" && (
          <div>
            <SectionTitle icon="🔧">Trade Package Breakdown</SectionTitle>
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={DEMO_BOQ.tradePackageSubtotals}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="tradePackage" tick={{ fill: C.textMuted, fontSize: 9 }} angle={-25} textAnchor="end" height={80} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 10 }} tickFormatter={fmtK} />
                  <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 6 }} formatter={(v) => [fmt(v)]} />
                  <Bar dataKey="totalCost" fill={C.accent} radius={[4, 4, 0, 0]}>
                    {DEMO_BOQ.tradePackageSubtotals.map((_, i) => <Cell key={i} fill={C.division[i % C.division.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                    {["Trade Package", "Total Cost", "% of Direct", "Line Items"].map(h => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", color: C.textMuted, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DEMO_BOQ.tradePackageSubtotals.map((tp, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: C.division[i % C.division.length] }} />
                        {tp.tradePackage}
                      </td>
                      <td style={{ padding: "10px 16px", color: C.accent }}>{fmt(tp.totalCost)}</td>
                      <td style={{ padding: "10px 16px", color: C.textMuted }}>{((tp.totalCost / DEMO_BOQ.directCost) * 100).toFixed(1)}%</td>
                      <td style={{ padding: "10px 16px", color: C.textDim }}>{tp.lineCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ RISK & GAPS ═══ */}
        {activeTab === "risk" && (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <StatCard label="Total Gaps" value={DEMO_EXEC.riskSummary.totalGaps} accent={C.red} />
              <StatCard label="Critical Gaps" value={DEMO_EXEC.riskSummary.criticalGaps} accent={C.red} />
              <StatCard label="RFIs Required" value={DEMO_EXEC.riskSummary.rfisRequired} accent={C.amber} />
              <StatCard label="Clashes Found" value={DEMO_EXEC.riskSummary.clashesFound} sub={`${DEMO_EXEC.riskSummary.criticalClashes} critical`} accent={C.amber} />
              <StatCard label="Constructability" value={DEMO_EXEC.riskSummary.constructabilityIssues} sub="issues" accent={C.purple} />
            </div>

            <SectionTitle icon="📌">Risk Matrix</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                { title: "Data Completeness", value: `${DEMO_EXEC.confidenceAnalysis.dataCompleteness}%`, color: DEMO_EXEC.confidenceAnalysis.dataCompleteness >= 70 ? C.green : C.amber, desc: "Overall data quality" },
                { title: "Estimate Accuracy", value: `${DEMO_EXEC.confidenceAnalysis.accuracyRange.low}% to +${DEMO_EXEC.confidenceAnalysis.accuracyRange.high}%`, color: C.amber, desc: DEMO_EXEC.confidenceAnalysis.estimateClass },
                { title: "Resolution Priority", value: DEMO_EXEC.riskSummary.criticalGaps > 0 ? "HIGH" : "MEDIUM", color: DEMO_EXEC.riskSummary.criticalGaps > 0 ? C.red : C.amber, desc: `${DEMO_EXEC.riskSummary.criticalGaps} critical items pending` },
              ].map((item, i) => (
                <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{item.title.toUpperCase()}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: item.color, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────── */}
        <div style={{ marginTop: 40, padding: "16px 0", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textDim }}>
          <span>EstimatorPro v3 · SOP Parts 3–8 Complete · QS Level 5 (42/42) · {DEMO_BOQ.metadata.reportId}</span>
          <span>CIQS Standard Method · CSI MasterFormat 2018 · AACE 18R-97 · RICS NRM1/NRM2</span>
        </div>
      </div>
    </div>
  );
}
