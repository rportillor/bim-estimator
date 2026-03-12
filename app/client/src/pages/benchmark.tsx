/**
 * Benchmark Comparison Page — M-4
 * ============================================================
 * Surfaces all server-side benchmark modules to the UI:
 *   GET  /api/qs5/benchmarks                              — reference cost/m² database
 *   GET  /api/qs5/projects/:projectId/validation-summary — stored benchmark + completeness
 *   POST /api/qs5/projects/:projectId/benchmark          — run cost/m² comparison
 *   POST /api/qs5/projects/:projectId/completeness       — run division completeness check
 *   GET  /api/estimates/:modelId/benchmark               — benchmark-core pack validation
 *
 * Standards: CIQS, AACE 18R-97, Altus Group Canadian Cost Guide 2025, RSMeans
 * Project:   The Moorings on Cameron Lake, Fenelon Falls, Ontario
 */

import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  BookOpen,
} from "lucide-react";

// ── Types matching server response shapes ──────────────────────────────────

interface BenchmarkRange {
  buildingType: string;
  displayName: string;
  lowPerM2: number;
  midPerM2: number;
  highPerM2: number;
  source: string;
  notes: string;
}

interface BenchmarkFinding {
  type: "pass" | "info" | "warning" | "critical";
  metric: string;
  message: string;
  actual?: number | string;
  expected?: string;
}

interface BenchmarkComparison {
  projectId: string;
  buildingType: string;
  grossFloorArea: number;
  totalDirectCost: number;
  costPerM2: number;
  benchmark: BenchmarkRange | null;
  status: "below" | "within" | "above" | "no-benchmark";
  variancePercent: number | null;
  findings: BenchmarkFinding[];
  runAt: string;
}

interface CompletenessCheck {
  projectId: string;
  buildingType: string;
  presentDivisions: string[];
  missingDivisions: string[];
  extraDivisions: string[];
  completenessPercent: number;
  findings: BenchmarkFinding[];
  runAt: string;
}

interface ValidationSummary {
  benchmark: BenchmarkComparison | null;
  completeness: CompletenessCheck | null;
}

interface PackBenchmarkReport {
  projectName: string;
  projectCategory: string;
  projectType: string;
  costStatus: "below" | "within" | "above" | "no-benchmark";
  actualCostPerUnit: number;
  budgetCostPerUnit: number;
  measurementUnit: string;
  overallStatus: "pass" | "review" | "fail";
  passCount: number;
  warningCount: number;
  criticalCount: number;
  findings: BenchmarkFinding[];
  dataQualityScore: number;
  generatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BUILDING_TYPE_LABELS: Record<string, string> = {
  residential_lowrise:       "Residential — Low-Rise (1–3 storeys)",
  residential_midrise:       "Residential — Mid-Rise (4–8 storeys)",
  residential_highrise:      "Residential — High-Rise (9+ storeys)",
  commercial_office:         "Commercial — Office",
  commercial_retail:         "Commercial — Retail",
  institutional_education:   "Institutional — Education",
  institutional_healthcare:  "Institutional — Healthcare",
  industrial_warehouse:      "Industrial — Warehouse / Distribution",
  industrial_manufacturing:  "Industrial — Manufacturing",
  mixed_use:                 "Mixed-Use",
};

function statusBadge(status: string) {
  switch (status) {
    case "within":  return <Badge className="bg-green-100 text-green-800 border-green-300">✓ Within Range</Badge>;
    case "below":   return <Badge className="bg-blue-100 text-blue-800 border-blue-300"><TrendingDown className="h-3 w-3 mr-1 inline" />Below Range</Badge>;
    case "above":   return <Badge className="bg-red-100 text-red-800 border-red-300"><TrendingUp className="h-3 w-3 mr-1 inline" />Above Range</Badge>;
    default:        return <Badge variant="secondary">No Benchmark</Badge>;
  }
}

function overallBadge(status: string) {
  switch (status) {
    case "pass":   return <Badge className="bg-green-100 text-green-800">Pass</Badge>;
    case "review": return <Badge className="bg-yellow-100 text-yellow-800">Review Required</Badge>;
    case "fail":   return <Badge className="bg-red-100 text-red-800">Fail</Badge>;
    default:       return null;
  }
}

function findingIcon(type: string) {
  switch (type) {
    case "pass":     return <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />;
    case "critical": return <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />;
    case "warning":  return <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />;
    default:         return <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />;
  }
}

function fmt$(n: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const params = useParams<{ projectId?: string; modelId?: string }>();
  const projectId = params.projectId || "";
  const modelId   = params.modelId   || "";

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [selectedBuildingType, setSelectedBuildingType] = useState<string>("");
  const [grossFloorArea,        setGrossFloorArea]       = useState<string>("");
  const [runModelId,            setRunModelId]           = useState<string>(modelId);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: benchmarkDb } = useQuery<{ benchmarks: BenchmarkRange[] }>({
    queryKey: ["/api/qs5/benchmarks"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<ValidationSummary>({
    queryKey: [`/api/qs5/projects/${projectId}/validation-summary`],
    enabled: Boolean(projectId),
    retry: false,
  });

  const { data: packReport } = useQuery<{ report: PackBenchmarkReport; formatted: string }>({
    queryKey: [`/api/estimates/${runModelId}/benchmark`],
    enabled: Boolean(runModelId),
    retry: false,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const runBenchmark = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/qs5/projects/${projectId}/benchmark`, {
        modelId: runModelId,
        buildingType: selectedBuildingType,
        grossFloorArea: parseFloat(grossFloorArea),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/validation-summary`] });
      toast({ title: "Benchmark run complete", description: "Cost/m² comparison updated." });
    },
    onError: (e: any) => toast({ title: "Benchmark failed", description: e?.message, variant: "destructive" }),
  });

  const runCompleteness = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/qs5/projects/${projectId}/completeness`, {
        modelId: runModelId,
        buildingType: selectedBuildingType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/validation-summary`] });
      toast({ title: "Completeness check complete", description: "Division coverage updated." });
    },
    onError: (e: any) => toast({ title: "Completeness check failed", description: e?.message, variant: "destructive" }),
  });

  const canRun = Boolean(projectId && runModelId && selectedBuildingType && parseFloat(grossFloorArea) > 0);
  const benchmark   = summary?.benchmark   ?? null;
  const completeness = summary?.completeness ?? null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <BarChart3 className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-gray-900">Benchmark Comparison</h1>
        </div>
        <p className="text-sm text-gray-500">
          CIQS / AACE 18R-97 · Altus Group Canadian Cost Guide 2025 · RSMeans ·
          Cost/m² validation against Canadian building type benchmarks
        </p>
      </div>

      {/* ── Run Panel ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Validation</CardTitle>
          <CardDescription>
            Requires an existing estimate for the model. Run BIM generation first if no estimate exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="modelId">Model ID</Label>
              <Input
                id="modelId"
                placeholder="e.g. 42"
                value={runModelId}
                onChange={e => setRunModelId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="buildingType">Building Type</Label>
              <Select value={selectedBuildingType} onValueChange={setSelectedBuildingType}>
                <SelectTrigger id="buildingType">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BUILDING_TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gfa">Gross Floor Area (m²)</Label>
              <Input
                id="gfa"
                type="number"
                placeholder="e.g. 3500"
                value={grossFloorArea}
                onChange={e => setGrossFloorArea(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => runBenchmark.mutate()}
                disabled={!canRun || runBenchmark.isPending}
                className="flex-1"
              >
                {runBenchmark.isPending
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Running…</>
                  : "Run Benchmark"
                }
              </Button>
              <Button
                variant="outline"
                onClick={() => runCompleteness.mutate()}
                disabled={!Boolean(projectId && runModelId && selectedBuildingType) || runCompleteness.isPending}
                className="flex-1"
              >
                {runCompleteness.isPending
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Checking…</>
                  : "Check Completeness"
                }
              </Button>
            </div>
          </div>
          {!projectId && (
            <Alert className="mt-4">
              <Info className="h-4 w-4" />
              <AlertDescription>
                Navigate to a project to run benchmark validation:
                <code className="ml-1 text-xs bg-gray-100 px-1 rounded">/projects/:projectId/benchmark</code>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ── Results Tabs ── */}
      <Tabs defaultValue="cost-benchmark">
        <TabsList>
          <TabsTrigger value="cost-benchmark">Cost/m² Benchmark</TabsTrigger>
          <TabsTrigger value="completeness">Division Completeness</TabsTrigger>
          <TabsTrigger value="pack-validation">Pack Validation</TabsTrigger>
          <TabsTrigger value="reference">Reference Database</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Cost/m² Benchmark ── */}
        <TabsContent value="cost-benchmark" className="space-y-4">
          {summaryLoading && <p className="text-sm text-gray-500 py-4">Loading…</p>}

          {!summaryLoading && !benchmark && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No benchmark result yet. Select a building type and GFA above, then click Run Benchmark.
              </AlertDescription>
            </Alert>
          )}

          {benchmark && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Actual Cost/m²</p>
                    <p className="text-2xl font-bold text-gray-900">{fmt$(benchmark.costPerM2)}</p>
                    <p className="text-xs text-gray-400 mt-1">Direct cost ÷ GFA</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Benchmark Range</p>
                    {benchmark.benchmark ? (
                      <p className="text-lg font-semibold text-gray-800">
                        {fmt$(benchmark.benchmark.lowPerM2)} – {fmt$(benchmark.benchmark.highPerM2)}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-400">No benchmark available</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">Mid: {benchmark.benchmark ? fmt$(benchmark.benchmark.midPerM2) : "—"}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Variance</p>
                    {benchmark.variancePercent !== null ? (
                      <p className={`text-2xl font-bold ${Math.abs(benchmark.variancePercent) <= 15 ? "text-green-700" : "text-red-600"}`}>
                        {fmtPct(benchmark.variancePercent)}
                      </p>
                    ) : (
                      <p className="text-2xl font-bold text-gray-400">—</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">vs. benchmark mid</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Status</p>
                    <div className="mt-1">{statusBadge(benchmark.status)}</div>
                    <p className="text-xs text-gray-400 mt-2">GFA: {benchmark.grossFloorArea.toLocaleString()} m²</p>
                  </CardContent>
                </Card>
              </div>

              {/* Benchmark bar */}
              {benchmark.benchmark && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Cost/m² Position</CardTitle>
                    <CardDescription className="text-xs">
                      {BUILDING_TYPE_LABELS[benchmark.buildingType] ?? benchmark.buildingType} ·
                      Source: {benchmark.benchmark.source}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative h-10 bg-gray-100 rounded-lg overflow-hidden mt-2">
                      {/* Low–High bar */}
                      {(() => {
                        const min = benchmark.benchmark!.lowPerM2  * 0.7;
                        const max = benchmark.benchmark!.highPerM2 * 1.3;
                        const span = max - min;
                        const lowPct  = ((benchmark.benchmark!.lowPerM2  - min) / span) * 100;
                        const highPct = ((benchmark.benchmark!.highPerM2 - min) / span) * 100;
                        const actPct  = Math.min(100, Math.max(0, ((benchmark.costPerM2 - min) / span) * 100));
                        return (
                          <>
                            <div
                              className="absolute top-0 bottom-0 bg-green-200"
                              style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
                            />
                            <div
                              className="absolute top-0 bottom-0 w-1 bg-primary"
                              style={{ left: `${actPct}%` }}
                              title={`Actual: ${fmt$(benchmark.costPerM2)}/m²`}
                            />
                            <div className="absolute inset-0 flex items-center justify-between px-3 text-xs text-gray-600 pointer-events-none">
                              <span>{fmt$(benchmark.benchmark!.lowPerM2)}</span>
                              <span className="font-semibold text-gray-800">Mid {fmt$(benchmark.benchmark!.midPerM2)}</span>
                              <span>{fmt$(benchmark.benchmark!.highPerM2)}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{benchmark.benchmark.notes}</p>
                  </CardContent>
                </Card>
              )}

              {/* Findings */}
              {benchmark.findings?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Findings</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {benchmark.findings.map((f, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        {findingIcon(f.type)}
                        <div>
                          <span className="font-medium text-gray-700">{f.metric}: </span>
                          <span className="text-gray-600">{f.message}</span>
                          {f.actual !== undefined && (
                            <span className="ml-1 text-gray-400 text-xs">(actual: {f.actual})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Tab 2: Division Completeness ── */}
        <TabsContent value="completeness" className="space-y-4">
          {!completeness && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No completeness result yet. Select a building type above, then click Check Completeness.
              </AlertDescription>
            </Alert>
          )}

          {completeness && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Completeness</p>
                    <p className={`text-3xl font-bold ${completeness.completenessPercent >= 80 ? "text-green-700" : completeness.completenessPercent >= 60 ? "text-yellow-600" : "text-red-600"}`}>
                      {completeness.completenessPercent.toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-400 mt-1">of expected divisions present</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Present Divisions</p>
                    <p className="text-3xl font-bold text-gray-800">{completeness.presentDivisions.length}</p>
                    <p className="text-xs text-gray-400 mt-1">of {completeness.presentDivisions.length + completeness.missingDivisions.length} expected</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Missing Divisions</p>
                    <p className={`text-3xl font-bold ${completeness.missingDivisions.length === 0 ? "text-green-700" : "text-red-600"}`}>
                      {completeness.missingDivisions.length}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">require attention</p>
                  </CardContent>
                </Card>
              </div>

              {completeness.missingDivisions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-red-700">Missing CSI Divisions</CardTitle>
                    <CardDescription className="text-xs">
                      Expected for {BUILDING_TYPE_LABELS[completeness.buildingType] ?? completeness.buildingType} — not found in estimate
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {completeness.missingDivisions.map(d => (
                        <Badge key={d} variant="destructive" className="text-xs">{d}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {completeness.presentDivisions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-green-700">Present CSI Divisions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {completeness.presentDivisions.map(d => (
                        <Badge key={d} className="bg-green-100 text-green-800 text-xs">{d}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {completeness.extraDivisions?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-blue-700">Extra Divisions</CardTitle>
                    <CardDescription className="text-xs">Present in estimate but not expected for this building type</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {completeness.extraDivisions.map(d => (
                        <Badge key={d} className="bg-blue-100 text-blue-800 text-xs">{d}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {completeness.findings?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Findings</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {completeness.findings.map((f, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        {findingIcon(f.type)}
                        <span className="text-gray-600">{f.message}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Tab 3: Pack Validation (benchmark-core) ── */}
        <TabsContent value="pack-validation" className="space-y-4">
          {!runModelId && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>Enter a Model ID above to load pack-based validation.</AlertDescription>
            </Alert>
          )}

          {runModelId && !packReport && (
            <p className="text-sm text-gray-500 py-4">
              No pack validation data. The estimate for model {runModelId} may not exist yet.
            </p>
          )}

          {packReport?.report && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Overall Status</p>
                    <div className="mt-1">{overallBadge(packReport.report.overallStatus)}</div>
                    <p className="text-xs text-gray-400 mt-2">{packReport.report.projectCategory} / {packReport.report.projectType}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Actual Cost/{packReport.report.measurementUnit}</p>
                    <p className="text-2xl font-bold text-gray-900">{fmt$(packReport.report.actualCostPerUnit)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Budget Cost/{packReport.report.measurementUnit}</p>
                    <p className="text-2xl font-bold text-gray-900">{fmt$(packReport.report.budgetCostPerUnit)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <p className="text-xs text-gray-500 mb-1">Data Quality</p>
                    <p className={`text-2xl font-bold ${packReport.report.dataQualityScore >= 80 ? "text-green-700" : "text-yellow-600"}`}>
                      {packReport.report.dataQualityScore.toFixed(0)}%
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card className="border-green-200">
                  <CardContent className="pt-4 text-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-green-700">{packReport.report.passCount}</p>
                    <p className="text-xs text-gray-500">Passed</p>
                  </CardContent>
                </Card>
                <Card className="border-yellow-200">
                  <CardContent className="pt-4 text-center">
                    <AlertTriangle className="h-6 w-6 text-yellow-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-yellow-700">{packReport.report.warningCount}</p>
                    <p className="text-xs text-gray-500">Warnings</p>
                  </CardContent>
                </Card>
                <Card className="border-red-200">
                  <CardContent className="pt-4 text-center">
                    <XCircle className="h-6 w-6 text-red-600 mx-auto mb-1" />
                    <p className="text-2xl font-bold text-red-700">{packReport.report.criticalCount}</p>
                    <p className="text-xs text-gray-500">Critical</p>
                  </CardContent>
                </Card>
              </div>

              {packReport.report.findings?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Pack Findings</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {packReport.report.findings.map((f, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        {findingIcon(f.type)}
                        <div>
                          <span className="font-medium text-gray-700">{f.metric}: </span>
                          <span className="text-gray-600">{f.message}</span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Raw text report */}
              {packReport.formatted && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Full Text Report
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-gray-50 p-3 rounded border overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                      {packReport.formatted}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Tab 4: Reference Database ── */}
        <TabsContent value="reference" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Canadian Building Cost Database</CardTitle>
              <CardDescription className="text-xs">
                Altus Group Canadian Cost Guide 2025 / RSMeans · All figures in CAD $/m² GFA · Direct cost only
              </CardDescription>
            </CardHeader>
            <CardContent>
              {benchmarkDb?.benchmarks ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-gray-700 pr-4">Building Type</th>
                        <th className="pb-2 font-medium text-gray-700 text-right pr-4">Low $/m²</th>
                        <th className="pb-2 font-medium text-gray-700 text-right pr-4">Mid $/m²</th>
                        <th className="pb-2 font-medium text-gray-700 text-right pr-4">High $/m²</th>
                        <th className="pb-2 font-medium text-gray-700">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkDb.benchmarks.map((b, i) => (
                        <tr key={b.buildingType} className={i % 2 === 0 ? "bg-gray-50" : ""}>
                          <td className="py-2 pr-4 font-medium text-gray-800">{b.displayName}</td>
                          <td className="py-2 pr-4 text-right text-gray-600">{fmt$(b.lowPerM2)}</td>
                          <td className="py-2 pr-4 text-right font-semibold text-gray-800">{fmt$(b.midPerM2)}</td>
                          <td className="py-2 pr-4 text-right text-gray-600">{fmt$(b.highPerM2)}</td>
                          <td className="py-2 text-xs text-gray-500 max-w-xs">{b.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Loading benchmark database…</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
