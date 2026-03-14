// client/src/components/bim-coordination/penetration-matrix-panel.tsx
// =============================================================================
// PENETRATION MATRIX PANEL — SOP Part 12 Frontend
// =============================================================================
//
// Penetration matrix visualization:
//   - Color-coded grid: rows=levels, cols=discipline pairs
//   - 5 statuses: OK / SLEEVE_MISSING / FIRESTOP_UNDEFINED / RATING_UNKNOWN / SIZE_UNKNOWN
//   - Global summary with completion percentage
//   - CSV download
//   - RFI count per cell
//
// Pattern: @tanstack/react-query + shadcn/ui + lucide-react
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Download,
  Grid3X3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Loader2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface PenetrationMatrix {
  generatedDate: string;
  projectName: string;
  levels: string[];
  disciplinePairs: string[];
  rows: PenetrationMatrixRow[];
  globalSummary: {
    total: number;
    byStatus: Record<string, number>;
    byDiscipline: Record<string, number>;
    rfisRequired: number;
    completionPercent: number;
  };
}

interface PenetrationMatrixRow {
  level: string;
  totalPenetrations: number;
  totalOK: number;
  totalIssues: number;
  rfisRequired: number;
  cells: PenetrationMatrixCell[];
}

interface PenetrationMatrixCell {
  level: string;
  disciplinePair: string;
  total: number;
  byStatus: Record<string, number>;
  worstStatus: string;
  rfisRequired: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: any; label: string }> = {
  OK: { bg: "bg-green-100", text: "text-green-800", icon: CheckCircle2, label: "OK" },
  SLEEVE_MISSING: { bg: "bg-red-100", text: "text-red-800", icon: XCircle, label: "Sleeve Missing" },
  FIRESTOP_UNDEFINED: { bg: "bg-orange-100", text: "text-orange-800", icon: AlertTriangle, label: "Firestop Undefined" },
  RATING_UNKNOWN: { bg: "bg-yellow-100", text: "text-yellow-800", icon: HelpCircle, label: "Rating Unknown" },
  SIZE_UNKNOWN: { bg: "bg-gray-100", text: "text-gray-700", icon: HelpCircle, label: "Size Unknown" },
};

const CELL_COLORS: Record<string, string> = {
  OK: "bg-green-200 hover:bg-green-300",
  SLEEVE_MISSING: "bg-red-300 hover:bg-red-400",
  FIRESTOP_UNDEFINED: "bg-orange-300 hover:bg-orange-400",
  RATING_UNKNOWN: "bg-yellow-300 hover:bg-yellow-400",
  SIZE_UNKNOWN: "bg-gray-300 hover:bg-gray-400",
};

// ═══════════════════════════════════════════════════════════════════════════════
// CELL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

function MatrixCell({ cell }: { cell: PenetrationMatrixCell | undefined }) {
  if (!cell || cell.total === 0) {
    return <td className="px-2 py-1 text-center text-[10px] text-muted-foreground bg-gray-50">—</td>;
  }

  const cellColor = CELL_COLORS[cell.worstStatus] || CELL_COLORS.OK;
  const okCount = cell.byStatus.OK || 0;

  return (
    <td className={`px-2 py-1 text-center cursor-default transition-colors ${cellColor}`} title={`${cell.disciplinePair} at ${cell.level}: ${okCount}/${cell.total} OK, ${cell.rfisRequired} RFIs`}>
      <div className="text-[10px] font-mono font-bold">{okCount}/{cell.total}</div>
      {cell.rfisRequired > 0 && (
        <div className="text-[9px] text-red-800 font-medium">{cell.rfisRequired} RFI</div>
      )}
    </td>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETION RING
// ═══════════════════════════════════════════════════════════════════════════════

function CompletionRing({ percent }: { percent: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 90 ? "#22c55e" : percent >= 70 ? "#eab308" : percent >= 50 ? "#f97316" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="44" cy="44" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 44 44)"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-lg font-bold" style={{ color }}>{percent}%</div>
        <div className="text-[9px] text-muted-foreground">Complete</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════════

async function downloadCSV() {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch("/api/bim-coordination/penetrations?format=csv", { headers, credentials: "include" });
  if (!res.ok) return;
  const csv = await res.text();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `penetrations-matrix-${new Date().toISOString().substring(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function PenetrationMatrixPanel() {
  const matrixQuery = useQuery<PenetrationMatrix>({
    queryKey: ["bim-penetrations"],
    queryFn: async () => {
      const t = localStorage.getItem("auth_token");
      const h: Record<string, string> = {};
      if (t) h["Authorization"] = `Bearer ${t}`;
      const res = await fetch("/api/bim-coordination/penetrations", { headers: h, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load penetrations");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const matrix = matrixQuery.data;

  if (matrixQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!matrix || !matrix.rows || matrix.rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Grid3X3 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Penetration Data</h3>
          <p className="text-sm text-muted-foreground">Run discipline tests to generate the penetrations matrix.</p>
        </CardContent>
      </Card>
    );
  }

  const gs = matrix.globalSummary;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Penetrations Matrix</h2>
          <p className="text-sm text-muted-foreground">
            SOP Part 12 — {gs.total} penetrations across {matrix.levels.length} levels, {matrix.disciplinePairs.length} discipline pairs
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={downloadCSV}>
          <Download className="w-3 h-3" /> Export CSV
        </Button>
      </div>

      {/* ── Summary Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="col-span-2 md:col-span-1 flex items-center justify-center py-4">
          <CompletionRing percent={gs.completionPercent} />
        </Card>
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
          const count = gs.byStatus[status] || 0;
          if (count === 0 && status !== "OK") return null;
          const Icon = cfg.icon;
          return (
            <Card key={status} className="border-l-4" style={{ borderLeftColor: status === "OK" ? "#22c55e" : status === "SLEEVE_MISSING" ? "#ef4444" : "#f97316" }}>
              <CardContent className="pt-3 pb-2 px-3">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className={`w-3 h-3 ${cfg.text}`} />
                  <span className="text-[10px] text-muted-foreground uppercase">{cfg.label}</span>
                </div>
                <p className="text-xl font-bold">{count}</p>
              </CardContent>
            </Card>
          );
        })}
        {gs.rfisRequired > 0 && (
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="pt-3 pb-2 px-3">
              <span className="text-[10px] text-muted-foreground uppercase">RFIs Required</span>
              <p className="text-xl font-bold text-red-600">{gs.rfisRequired}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Matrix Grid ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Level × Discipline Pair Matrix</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-[10px]">Level</th>
                  <th className="px-2 py-2 text-center font-medium text-[10px]">Total</th>
                  <th className="px-2 py-2 text-center font-medium text-[10px]">OK</th>
                  <th className="px-2 py-2 text-center font-medium text-[10px]">Issues</th>
                  {matrix.disciplinePairs.map(pair => (
                    <th key={pair} className="px-2 py-2 text-center font-medium text-[10px] whitespace-nowrap">
                      {pair.replace(/_vs_/g, " / ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row.level} className="border-t">
                    <td className="px-3 py-1 font-medium">{row.level}</td>
                    <td className="px-2 py-1 text-center font-mono">{row.totalPenetrations}</td>
                    <td className="px-2 py-1 text-center font-mono text-green-700">{row.totalOK}</td>
                    <td className={`px-2 py-1 text-center font-mono ${row.totalIssues > 0 ? "text-red-700 font-bold" : ""}`}>
                      {row.totalIssues}
                    </td>
                    {matrix.disciplinePairs.map(pair => {
                      const cell = row.cells.find(c => c.disciplinePair === pair);
                      return <MatrixCell key={pair} cell={cell} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Legend ───────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-3 pb-2">
          <div className="flex flex-wrap gap-4">
            {Object.entries(CELL_COLORS).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1.5">
                <div className={`w-4 h-3 rounded-sm ${color}`} />
                <span className="text-[10px] text-muted-foreground">{status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
