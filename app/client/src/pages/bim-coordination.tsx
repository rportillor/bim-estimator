// client/src/pages/bim-coordination.tsx
// =============================================================================
// BIM COORDINATION PAGE — SOP Parts 7-13 Unified Frontend
// =============================================================================
//
// 7-tab coordination dashboard:
//   Tab 1: Clash Detection  — Run tests, view groups, create issues
//   Tab 2: Issue Tracker    — 9-state workflow, RFI generation
//   Tab 3: BCF Viewer       — BCF 2.1 topics, viewpoints, export
//   Tab 4: Trends           — Burndown, velocity, hotspots, root causes
//   Tab 5: Penetrations     — Level × discipline matrix, CSV export
//   Tab 6: Governance       — Cadence, SLA, meeting packs
//   Tab 7: Model Gate       — Quality gate, gap register
//
// Pattern: @tanstack/react-query + shadcn/ui + wouter + lucide-react
// =============================================================================

import { useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  Shield,
  AlertTriangle,
  FileText,
  TrendingUp,
  Grid3X3,
  Calendar,
  CheckCircle2,
} from "lucide-react";

// Lazy-load panels for code splitting
const ClashDashboard = lazy(() => import("@/components/bim-coordination/clash-dashboard"));
const IssueTrackerPanel = lazy(() => import("@/components/bim-coordination/issue-tracker-panel"));
const BCFViewerPanel = lazy(() => import("@/components/bim-coordination/bcf-viewer-panel"));
const TrendChartPanel = lazy(() => import("@/components/bim-coordination/trend-chart-panel"));
const PenetrationMatrixPanel = lazy(() => import("@/components/bim-coordination/penetration-matrix-panel"));
const GovernancePanel = lazy(() => import("@/components/bim-coordination/governance-panel"));
const ModelGatePanel = lazy(() => import("@/components/bim-coordination/model-gate-panel"));

// ═══════════════════════════════════════════════════════════════════════════════
// TAB DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

type TabKey = "clashes" | "issues" | "bcf" | "trends" | "penetrations" | "governance" | "gate";

const TABS: { key: TabKey; label: string; shortLabel: string; icon: React.ReactNode; sopRef: string }[] = [
  { key: "clashes", label: "Clash Detection", shortLabel: "Clashes", icon: <Shield className="w-4 h-4" />, sopRef: "Part 7" },
  { key: "issues", label: "Issue Tracker", shortLabel: "Issues", icon: <AlertTriangle className="w-4 h-4" />, sopRef: "Part 8" },
  { key: "bcf", label: "BCF Viewer", shortLabel: "BCF", icon: <FileText className="w-4 h-4" />, sopRef: "Part 9" },
  { key: "trends", label: "Trend Analytics", shortLabel: "Trends", icon: <TrendingUp className="w-4 h-4" />, sopRef: "Part 10" },
  { key: "penetrations", label: "Penetrations Matrix", shortLabel: "Matrix", icon: <Grid3X3 className="w-4 h-4" />, sopRef: "Part 12" },
  { key: "governance", label: "Governance & SLA", shortLabel: "Gov", icon: <Calendar className="w-4 h-4" />, sopRef: "Part 13" },
  { key: "gate", label: "Model Gate", shortLabel: "Gate", icon: <CheckCircle2 className="w-4 h-4" />, sopRef: "Part 2" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL LOADER
// ═══════════════════════════════════════════════════════════════════════════════

function PanelLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Loading panel...</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY BAR
// ═══════════════════════════════════════════════════════════════════════════════

interface CoordinationSummary {
  project: string;
  engine: string;
  standards: string[];
  currentPhase: { phase: string; hoursUntilDeadline: number };
  issues: { byStatus: Record<string, number>; byPriority: Record<string, number>; overdue: number };
  sla: { onTrack: number; atRisk: number; breached: number };
  clashRuns: number;
  modelDrops: number;
  gaps: { total: number; openCount: number; closureRate: number };
  trends: { velocity: any; alertCount: number; hotspotCount: number } | null;
}

function SummaryBar({ summary }: { summary: CoordinationSummary | null }) {
  if (!summary) return null;

  const openIssues = Object.entries(summary.issues?.byStatus || {})
    .filter(([k]) => !["RESOLVED", "WONT_FIX", "DUPLICATE"].includes(k))
    .reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="flex flex-wrap gap-3 text-xs">
      <Badge variant="outline" className="gap-1">
        <Shield className="w-3 h-3" /> {summary.clashRuns} runs
      </Badge>
      <Badge variant="outline" className="gap-1">
        <AlertTriangle className="w-3 h-3" /> {openIssues} open issues
      </Badge>
      {summary.issues?.overdue > 0 && (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          {summary.issues.overdue} overdue
        </Badge>
      )}
      {summary.sla?.breached > 0 && (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          {summary.sla.breached} SLA breached
        </Badge>
      )}
      {summary.gaps && (
        <Badge variant="outline" className="gap-1">
          {summary.gaps.openCount} gaps open
        </Badge>
      )}
      <Badge variant="secondary" className="gap-1 text-[10px]">
        {summary.currentPhase?.phase?.replace(/_/g, " ")}
      </Badge>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BIMCoordinationPage() {
  const params = useParams();
  const projectId = params.projectId || "1";
  const modelId = params.modelId || "";
  const [activeTab, setActiveTab] = useState<TabKey>("clashes");

  // ── Summary query ────────────────────────────────────────────────────
  const summaryQuery = useQuery<CoordinationSummary>({
    queryKey: ["bim-coordination-summary", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/bim-coordination/summary?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div className="w-full min-h-screen bg-gray-50">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">BIM Coordination</h1>
            <p className="text-sm text-muted-foreground">
              {summaryQuery.data?.project ?? 'Loading project...'} — SOP Parts 7-13
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">
              CIQS · ISO 19650 · BCF 2.1 · CSI MasterFormat
            </Badge>
          </div>
        </div>
        <SummaryBar summary={summaryQuery.data || null} />
      </div>

      {/* ── Tab Navigation ──────────────────────────────────────────── */}
      <div className="bg-white border-b px-6 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
                }`}
              >
                {tab.icon}
                <span className="hidden md:inline">{tab.label}</span>
                <span className="md:hidden">{tab.shortLabel}</span>
                <span className="hidden lg:inline text-[10px] text-muted-foreground">({tab.sopRef})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Panel Content ───────────────────────────────────────────── */}
      <div className="p-6">
        <Suspense fallback={<PanelLoader />}>
          {activeTab === "clashes" && <ClashDashboard projectId={projectId} modelId={modelId} />}
          {activeTab === "issues" && <IssueTrackerPanel />}
          {activeTab === "bcf" && <BCFViewerPanel />}
          {activeTab === "trends" && <TrendChartPanel />}
          {activeTab === "penetrations" && <PenetrationMatrixPanel />}
          {activeTab === "governance" && <GovernancePanel projectId={projectId} />}
          {activeTab === "gate" && <ModelGatePanel />}
        </Suspense>
      </div>
    </div>
  );
}
