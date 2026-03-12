// client/src/components/grid/GridReviewDashboard.tsx
// ═══════════════════════════════════════════════════════════════════════════════
// GRID REVIEW DASHBOARD — WP-7: Human-in-the-Loop Review UI
// ═══════════════════════════════════════════════════════════════════════════════
//
// Four-tab dashboard for grid detection review:
//   1. Overview: Run history, stats, quality grade, confidence breakdown
//   2. Axes & Labels: Review/confirm/reject axis-label associations
//   3. Validation: Issue list with severity, RFI triggers, domain warnings
//   4. Detect: Trigger new detection runs on project documents
//
// Consumes: /api/grid-detection/* endpoints (WP-1 routes)
// ═══════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import {
  Grid3X3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Play,
  RefreshCw,
  Eye,
  Tag,
  Crosshair,
  Shield,
  BarChart3,
  Clock,
  FileText,
  Loader2,
  ChevronRight,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface GridDetectionRun {
  id: string;
  projectId: string;
  sourceFileId: string;
  inputType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

interface GridRunStats {
  runId: string;
  status: string;
  componentCount: number;
  familyCount: number;
  axisCount: number;
  labeledAxisCount: number;
  nodeCount: number;
  markerCount: number;
  needsReviewCount: number;
  avgConfidence: number;
}

interface AxisLabelAssociation {
  id: string;
  axisId: string;
  labelId: string;
  scoreTotal: string;
  scoreBreakdown: {
    endpointProximity: number;
    perpendicularDistance: number;
    directionalAlignment: number;
    markerSupport: number;
    textQuality: number;
  };
  associationType: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

interface ValidationIssue {
  code: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  affectedEntities: string[];
  suggestedAction: string;
  generatesRfi: boolean;
}

interface ConfidenceBreakdown {
  axes: { count: number; min: number; max: number; mean: number; median: number; belowThreshold: number };
  families: { count: number; scores: number[] };
  labeling: { totalAxes: number; labeledAxes: number; autoAssigned: number; needsReview: number; unlabeled: number; labelCoverage: number };
  nodes: { count: number; expectedCount: number; coverage: number; avgConfidence: number };
  runConfidence: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

interface ValidationReport {
  validatedAt: string;
  issues: ValidationIssue[];
  confidence: ConfidenceBreakdown;
  issueCounts: Record<string, number>;
  passesMinimumQuality: boolean;
  recommendedStatus: string;
  rfiCount: number;
}

interface DetectionResult {
  run: GridDetectionRun;
  stats: {
    componentCount: number;
    familyCount: number;
    axisCount: number;
    nodeCount: number;
    markerCount: number;
    labelCount: number;
    needsReviewCount: number;
  };
  validation: ValidationReport | null;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════════════════════════

interface GridReviewDashboardProps {
  projectId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function GridReviewDashboard({ projectId }: GridReviewDashboardProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const queryClient = useQueryClient();

  // ── Queries ──
  const { data: runsData, isLoading: runsLoading } = useQuery<{ success: boolean; runs: GridDetectionRun[] }>({
    queryKey: ["/api/grid-detection/runs", projectId],
  });

  const runs = runsData?.runs ?? [];
  const latestRun = runs.length > 0 ? runs[0] : null;
  const activeRunId = selectedRunId ?? latestRun?.id;

  const { data: statsData, isLoading: statsLoading } = useQuery<{ success: boolean; stats: GridRunStats }>({
    queryKey: ["/api/grid-detection/run", activeRunId, "stats"],
    enabled: !!activeRunId,
  });

  const { data: reviewData } = useQuery<{ success: boolean; items: AxisLabelAssociation[]; count: number }>({
    queryKey: ["/api/grid-detection/run", activeRunId, "needs-review"],
    enabled: !!activeRunId,
  });

  const { data: statusData } = useQuery<{ success: boolean; available: boolean; extractors: any[]; message: string }>({
    queryKey: ["/api/grid-detection/status"],
  });

  const stats = statsData?.stats;
  const reviewItems = reviewData?.items ?? [];

  // ── Mutations ──
  const confirmAxisLabel = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PUT", `/api/grid-detection/axis-label/${id}/status`, {
        status,
        reviewedBy: "user",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grid-detection/run", activeRunId] });
    },
  });

  const confirmAxis = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PUT", `/api/grid-detection/axis/${id}/status`, {
        status,
        reviewedBy: "user",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grid-detection/run", activeRunId] });
    },
  });

  const triggerDetection = useMutation({
    mutationFn: async (data: { sourceFileId: string; filename: string; storageKey: string }) => {
      const res = await apiRequest("POST", "/api/grid-detection/detect", {
        projectId,
        ...data,
        triggeredBy: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/grid-detection/runs", projectId] });
    },
  });

  // ── Loading State ──
  if (runsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Grid3X3 className="h-6 w-6" />
            Grid Detection Review
          </h1>
          <p className="text-muted-foreground mt-1">
            Review and confirm detected grid lines, labels, and intersections
          </p>
        </div>
        {stats && <QualityGradeBadge grade={stats.status === "SUCCESS" ? "A" : stats.status === "PARTIAL" ? "C" : "F"} confidence={stats.avgConfidence} />}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-1">
            <Tag className="h-4 w-4" />
            Axes & Labels
            {reviewItems.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">{reviewItems.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="validation" className="flex items-center gap-1">
            <Shield className="h-4 w-4" /> Validation
          </TabsTrigger>
          <TabsTrigger value="detect" className="flex items-center gap-1">
            <Play className="h-4 w-4" /> Detect
          </TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: OVERVIEW ═══ */}
        <TabsContent value="overview" className="space-y-4">
          <OverviewTab
            runs={runs}
            stats={stats}
            statsLoading={statsLoading}
            selectedRunId={activeRunId}
            onSelectRun={setSelectedRunId}
          />
        </TabsContent>

        {/* ═══ TAB 2: AXES & LABELS REVIEW ═══ */}
        <TabsContent value="review" className="space-y-4">
          <ReviewTab
            reviewItems={reviewItems}
            onConfirm={(id) => confirmAxisLabel.mutate({ id, status: "CONFIRMED" })}
            onReject={(id) => confirmAxisLabel.mutate({ id, status: "REJECTED" })}
            isPending={confirmAxisLabel.isPending}
          />
        </TabsContent>

        {/* ═══ TAB 3: VALIDATION ═══ */}
        <TabsContent value="validation" className="space-y-4">
          <ValidationTab runId={activeRunId} />
        </TabsContent>

        {/* ═══ TAB 4: DETECT ═══ */}
        <TabsContent value="detect" className="space-y-4">
          <DetectTab
            projectId={projectId}
            statusData={statusData}
            onTrigger={triggerDetection.mutate}
            isPending={triggerDetection.isPending}
            result={triggerDetection.data as any}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function QualityGradeBadge({ grade, confidence }: { grade: string; confidence: number }) {
  const colors: Record<string, string> = {
    A: "bg-green-100 text-green-800 border-green-300",
    B: "bg-blue-100 text-blue-800 border-blue-300",
    C: "bg-yellow-100 text-yellow-800 border-yellow-300",
    D: "bg-orange-100 text-orange-800 border-orange-300",
    F: "bg-red-100 text-red-800 border-red-300",
  };
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${colors[grade] ?? colors.F}`}>
      <span className="text-3xl font-bold">{grade}</span>
      <div className="text-sm">
        <div className="font-medium">Quality</div>
        <div>{(confidence * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  runs, stats, statsLoading, selectedRunId, onSelectRun,
}: {
  runs: GridDetectionRun[];
  stats: GridRunStats | undefined;
  statsLoading: boolean;
  selectedRunId: string | null | undefined;
  onSelectRun: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Stats Cards */}
      <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Grid3X3 className="h-4 w-4" />} label="Families" value={stats?.familyCount ?? 0} />
        <StatCard icon={<Crosshair className="h-4 w-4" />} label="Axes" value={stats?.axisCount ?? 0} />
        <StatCard icon={<Tag className="h-4 w-4" />} label="Labeled" value={stats?.labeledAxisCount ?? 0} />
        <StatCard icon={<Eye className="h-4 w-4" />} label="Nodes" value={stats?.nodeCount ?? 0} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Markers" value={stats?.markerCount ?? 0} />
        <StatCard
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
          label="Review"
          value={stats?.needsReviewCount ?? 0}
          highlight={!!stats && stats.needsReviewCount > 0}
        />
        <StatCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Confidence"
          value={stats ? `${(stats.avgConfidence * 100).toFixed(0)}%` : "—"}
        />
        <StatCard icon={<FileText className="h-4 w-4" />} label="Runs" value={runs.length} />
      </div>

      {/* Run History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Detection Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[280px]">
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No detection runs yet</p>
            ) : (
              <div className="space-y-1 px-4 pb-4">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    className={`w-full text-left p-2 rounded-md text-sm transition-colors ${
                      selectedRunId === run.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <StatusBadge status={run.status} />
                      <span className="text-xs text-muted-foreground">{run.inputType}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(run.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string | number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-amber-300 bg-amber-50" : ""}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <div className="text-xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    SUCCESS: { variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    PARTIAL: { variant: "secondary", icon: <AlertTriangle className="h-3 w-3" /> },
    FAILED: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };
  const v = variants[status] ?? variants.FAILED;
  return (
    <Badge variant={v.variant} className="text-xs flex items-center gap-1">
      {v.icon} {status}
    </Badge>
  );
}

// ─── Review Tab ──────────────────────────────────────────────────────────────

function ReviewTab({
  reviewItems, onConfirm, onReject, isPending,
}: {
  reviewItems: AxisLabelAssociation[];
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}) {
  if (reviewItems.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
          <h3 className="text-lg font-medium">All Clear</h3>
          <p className="text-muted-foreground text-sm mt-1">No axis-label associations need review</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          {reviewItems.length} Associations Need Review
        </CardTitle>
        <CardDescription>
          These label-axis associations scored below the auto-assign threshold.
          Confirm correct assignments or reject false positives.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Score</TableHead>
              <TableHead>Axis</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-[200px]">Score Breakdown</TableHead>
              <TableHead className="w-[140px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviewItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <ScoreBadge score={parseFloat(item.scoreTotal)} />
                </TableCell>
                <TableCell className="font-mono text-sm">{item.axisId.substring(0, 8)}...</TableCell>
                <TableCell className="font-mono text-sm">{item.labelId.substring(0, 8)}...</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{item.associationType}</Badge>
                </TableCell>
                <TableCell>
                  <ScoreBreakdownBar breakdown={item.scoreBreakdown} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onConfirm(item.id)}
                      disabled={isPending}
                      className="h-7 px-2"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => onReject(item.id)}
                      disabled={isPending}
                      className="h-7 px-2"
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const pct = score * 100;
  const color = pct >= 75 ? "text-green-700 bg-green-50" : pct >= 55 ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
  return <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${color}`}>{pct.toFixed(0)}%</span>;
}

function ScoreBreakdownBar({ breakdown }: { breakdown: AxisLabelAssociation["scoreBreakdown"] }) {
  const items = [
    { label: "End", value: breakdown.endpointProximity, color: "bg-blue-500" },
    { label: "Perp", value: breakdown.perpendicularDistance, color: "bg-green-500" },
    { label: "Align", value: breakdown.directionalAlignment, color: "bg-purple-500" },
    { label: "Mark", value: breakdown.markerSupport, color: "bg-orange-500" },
    { label: "Text", value: breakdown.textQuality, color: "bg-cyan-500" },
  ];
  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="flex gap-0.5 h-3 w-full min-w-[120px]">
          {items.map((item) => (
            <div
              key={item.label}
              className={`${item.color} rounded-sm`}
              style={{ width: `${item.value * 100}%`, opacity: 0.4 + item.value * 0.6 }}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs space-y-0.5">
          {items.map((item) => (
            <div key={item.label} className="flex justify-between gap-3">
              <span>{item.label}:</span>
              <span className="font-mono">{(item.value * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Validation Tab ──────────────────────────────────────────────────────────

function ValidationTab({ runId }: { runId: string | null | undefined }) {
  const { data: fullData } = useQuery<{ success: boolean; result: DetectionResult }>({
    queryKey: ["/api/grid-detection/run", runId, "full-result"],
    enabled: false, // We don't have a direct endpoint for validation yet — use detect result
  });

  // For now, show the validation from the detection result stored in the run
  // In a full implementation, validation would be stored alongside the run
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Validation Report
        </CardTitle>
        <CardDescription>
          Domain rules (NBC/OBC), topology checks, label coverage, and confidence scoring
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!runId ? (
          <p className="text-muted-foreground text-sm">No detection run selected</p>
        ) : (
          <ValidationReportDisplay runId={runId} />
        )}
      </CardContent>
    </Card>
  );
}

function ValidationReportDisplay({ runId }: { runId: string }) {
  const { data: statsData } = useQuery<{ success: boolean; stats: GridRunStats }>({
    queryKey: ["/api/grid-detection/run", runId, "stats"],
  });
  const stats = statsData?.stats;

  if (!stats) {
    return <p className="text-sm text-muted-foreground">Loading validation data...</p>;
  }

  // Render validation summary from available stats
  const items = [
    {
      label: "Grid Families",
      value: stats.familyCount,
      status: stats.familyCount >= 2 ? "pass" : "fail",
      detail: stats.familyCount >= 2 ? "Minimum 2 families (X + Y)" : "Insufficient families detected",
    },
    {
      label: "Axis Count",
      value: stats.axisCount,
      status: stats.axisCount >= 4 ? "pass" : stats.axisCount >= 2 ? "warn" : "fail",
      detail: `${stats.axisCount} axes detected across ${stats.familyCount} families`,
    },
    {
      label: "Label Coverage",
      value: stats.axisCount > 0 ? `${((stats.labeledAxisCount / stats.axisCount) * 100).toFixed(0)}%` : "0%",
      status: stats.labeledAxisCount >= stats.axisCount * 0.8 ? "pass" : stats.labeledAxisCount > 0 ? "warn" : "fail",
      detail: `${stats.labeledAxisCount}/${stats.axisCount} axes have labels`,
    },
    {
      label: "Grid Nodes",
      value: stats.nodeCount,
      status: stats.nodeCount > 0 ? "pass" : "warn",
      detail: `${stats.nodeCount} intersections detected`,
    },
    {
      label: "Markers",
      value: stats.markerCount,
      status: stats.markerCount > 0 ? "pass" : "warn",
      detail: `${stats.markerCount} grid bubbles detected`,
    },
    {
      label: "Review Queue",
      value: stats.needsReviewCount,
      status: stats.needsReviewCount === 0 ? "pass" : "warn",
      detail: stats.needsReviewCount === 0 ? "All associations auto-confirmed" : `${stats.needsReviewCount} need human review`,
    },
    {
      label: "Average Confidence",
      value: `${(stats.avgConfidence * 100).toFixed(0)}%`,
      status: stats.avgConfidence >= 0.7 ? "pass" : stats.avgConfidence >= 0.4 ? "warn" : "fail",
      detail: `Weighted average across all axes`,
    },
  ];

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between p-2 rounded-md bg-muted/30">
          <div className="flex items-center gap-2">
            {item.status === "pass" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : item.status === "warn" ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <div>
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.detail}</div>
            </div>
          </div>
          <span className="text-sm font-mono font-bold">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Detect Tab ──────────────────────────────────────────────────────────────

function DetectTab({
  projectId, statusData, onTrigger, isPending, result,
}: {
  projectId: string;
  statusData: any;
  onTrigger: (data: any) => void;
  isPending: boolean;
  result: { success: boolean; result: DetectionResult } | undefined;
}) {
  const { data: docsData } = useQuery<any[]>({
    queryKey: ["/api/projects", projectId, "documents"],
  });

  const documents = docsData ?? [];
  const drawingDocs = documents.filter((d: any) =>
    /plan|floor|section|elevation|structural|foundation|grid|framing|\.dxf|\.dwg|\.pdf/i.test(d.filename || d.originalName || "")
  );

  return (
    <div className="space-y-4">
      {/* System Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4" /> Detection System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusData?.available ? (
            <div className="space-y-2">
              <Badge variant="default" className="text-xs">Active</Badge>
              <div className="text-sm text-muted-foreground">
                Extractors: {statusData.extractors?.map((e: any) => `${e.name} (${e.types.join(", ")})`).join("; ")}
              </div>
            </div>
          ) : (
            <div>
              <Badge variant="secondary" className="text-xs">Limited</Badge>
              <p className="text-sm text-muted-foreground mt-1">{statusData?.message ?? "Loading..."}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Grid Detection</CardTitle>
          <CardDescription>Select a drawing document to detect grid lines from</CardDescription>
        </CardHeader>
        <CardContent>
          {drawingDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No drawing documents found in project. Upload DXF, DWG, or PDF files first.
            </p>
          ) : (
            <div className="space-y-2">
              {drawingDocs.slice(0, 10).map((doc: any) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{doc.originalName || doc.filename}</div>
                      <div className="text-xs text-muted-foreground">{doc.fileType}</div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTrigger({
                      sourceFileId: doc.id,
                      filename: doc.originalName || doc.filename,
                      storageKey: doc.storageKey || doc.filename,
                    })}
                    disabled={isPending}
                    className="h-7"
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                    Detect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detection Result */}
      {result?.result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <StatusBadge status={result.result.run.status} />
              Detection Complete — {result.result.durationMs}ms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>Families: <span className="font-bold">{result.result.stats.familyCount}</span></div>
              <div>Axes: <span className="font-bold">{result.result.stats.axisCount}</span></div>
              <div>Nodes: <span className="font-bold">{result.result.stats.nodeCount}</span></div>
              <div>Markers: <span className="font-bold">{result.result.stats.markerCount}</span></div>
              <div>Labels: <span className="font-bold">{result.result.stats.labelCount}</span></div>
              <div>Review: <span className="font-bold">{result.result.stats.needsReviewCount}</span></div>
            </div>
            {result.result.validation && (
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                <span className="text-sm">Quality Grade:</span>
                <QualityGradeBadge
                  grade={result.result.validation.confidence.grade}
                  confidence={result.result.validation.confidence.runConfidence}
                />
              </div>
            )}
            {result.result.warnings.length > 0 && (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {result.result.warnings.slice(0, 20).map((w, i) => (
                  <div key={i} className="text-xs text-muted-foreground font-mono">{w}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
