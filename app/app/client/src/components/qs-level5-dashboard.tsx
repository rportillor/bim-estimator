// client/src/components/qs-level5-dashboard.tsx
// =============================================================================
// QS LEVEL 5 DASHBOARD — COMPREHENSIVE FRONTEND
// =============================================================================
//
// Covers ALL endpoints wired in this project:
//   Tab 1: Estimate Lifecycle   — versions, diff, snapshot, freeze/approve
//   Tab 2: Dual Classification  — UNIFORMAT, NRM2, WBS, cross-walk
//   Tab 3: Benchmarking         — cost/m², completeness, validation
//   Tab 4: Trade Data           — labor burden, rebar, vendor quotes, alternates
//   Tab 5: Risk & Simulation    — Monte Carlo, range estimates
//   Tab 6: Schedule of Values   — SOV, progress certificates
//   Tab 7: Basis of Estimate    — BoE generation
//   Tab 8: Estimate Engine      — 22 /api/estimates/:modelId/* endpoints
//
// Pattern: @tanstack/react-query + shadcn/ui + wouter + lucide-react
// Standards: CIQS, AACE 18R-97, RICS NRM1/NRM2, CSI MasterFormat 2018, NBC/OBC
// Version: v14.27 — H-3 complete
// =============================================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import {
  BarChart3, Shield, FileCheck, DollarSign, Scale, ClipboardList, FileText,
  ChevronRight, RefreshCw, Download, CheckCircle, XCircle, AlertTriangle,
  Lock, Unlock, Send, Eye, TrendingUp, Layers, Cpu, Activity, Database
} from "lucide-react";
import { RateManagerTab } from "@/components/rate-manager";

// ─── TAB DEFINITIONS ────────────────────────────────────────────────────────

type TabKey = "lifecycle" | "classification" | "benchmark" | "trade" | "risk" | "sov" | "boe" | "engine" | "rates";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "lifecycle",      label: "Estimate Lifecycle",  icon: <FileCheck     className="w-4 h-4" /> },
  { key: "classification", label: "Dual Classification", icon: <Layers        className="w-4 h-4" /> },
  { key: "benchmark",      label: "Benchmarking",        icon: <BarChart3     className="w-4 h-4" /> },
  { key: "trade",          label: "Trade Data",          icon: <DollarSign    className="w-4 h-4" /> },
  { key: "risk",           label: "Risk & Simulation",   icon: <TrendingUp    className="w-4 h-4" /> },
  { key: "sov",            label: "Schedule of Values",  icon: <ClipboardList className="w-4 h-4" /> },
  { key: "boe",            label: "Basis of Estimate",   icon: <FileText      className="w-4 h-4" /> },
  { key: "engine",         label: "Estimate Engine",     icon: <Cpu           className="w-4 h-4" /> },
  { key: "rates",          label: "Rate Management",     icon: <Database      className="w-4 h-4" /> },
];

// ─── MAIN DASHBOARD ─────────────────────────────────────────────────────────

export default function QSLevel5Dashboard() {
  const params = useParams();
  const projectId = params.projectId || "default";
  const modelId = params.modelId || "";
  const [activeTab, setActiveTab] = useState<TabKey>("lifecycle");

  // Resolve project name from storage — no hardcoded fallback per no-defaults policy
  const { data: projectData } = useQuery<any>({
    queryKey: [`/api/projects/${projectId}`],
    queryFn: async () => {
      if (projectId === "default") return null;
      const res = await apiRequest("GET", `/api/projects/${projectId}`);
      return res.json();
    },
    enabled: projectId !== "default",
  });
  const projectName: string = projectData?.name
    ?? (projectId !== "default" ? `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found]` : '');

  return (
    <div className="w-full min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">QS Level 5 Dashboard</h1>
            <p className="text-sm text-gray-500">
              CIQS Methodology — {projectId !== "default" ? `Project: ${projectId}` : "Select a project"}
              {modelId && ` | Model: ${modelId}`}
            </p>
          </div>
          <Badge variant="outline" className="text-sm">
            77 API Endpoints Active
          </Badge>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border-b px-4 overflow-x-auto">
        <div className="flex space-x-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center space-x-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 max-w-7xl mx-auto">
        {activeTab === "lifecycle"      && <LifecycleTab      projectId={projectId} modelId={modelId} />}
        {activeTab === "classification" && <ClassificationTab modelId={modelId} />}
        {activeTab === "benchmark"      && <BenchmarkTab      projectId={projectId} modelId={modelId} projectData={projectData} />}
        {activeTab === "trade"          && <TradeDataTab      projectId={projectId} modelId={modelId} />}
        {activeTab === "risk"           && <RiskTab           projectId={projectId} modelId={modelId} />}
        {activeTab === "sov"            && <SOVTab            projectId={projectId} modelId={modelId} projectName={projectName} />}
        {activeTab === "boe"            && <BoETab            projectId={projectId} modelId={modelId} projectName={projectName} projectData={projectData} />}
        {activeTab === "engine"         && <EstimateEngineTab projectId={projectId} modelId={modelId} projectName={projectName} />}
        {activeTab === "rates"          && <RateManagerTab    projectId={projectId} modelId={modelId} />}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 1: ESTIMATE LIFECYCLE (versions, diff, maker-checker)
// ═══════════════════════════════════════════════════════════════════════════════

function LifecycleTab({ projectId, modelId }: { projectId: string; modelId: string }) {
  const queryClient = useQueryClient();
  const [maker, setMaker] = useState("");
  const [checker, setChecker] = useState("");
  const [diffFrom, setDiffFrom] = useState("");
  const [diffTo, setDiffTo] = useState("");

  const { data: versions, isLoading } = useQuery<any>({
    queryKey: [`/api/qs5/projects/${projectId}/versions`],
  });

  const { data: diffData } = useQuery<any>({
    queryKey: [`/api/qs5/projects/${projectId}/versions/diff?from=${diffFrom}&to=${diffTo}`],
    enabled: !!diffFrom && !!diffTo,
  });

  const createVersionMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/versions`, { modelId, maker, changeDescription: "New version" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const submitMut = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/qs5/versions/${versionId}/submit`, { actor: maker }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const approveMut = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/qs5/versions/${versionId}/approve`, { checker }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const rejectMut = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/qs5/versions/${versionId}/reject`, { checker, reason: "Review required" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const freezeMut = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/qs5/versions/${versionId}/freeze`, { actor: checker }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const reopenMut = useMutation({
    mutationFn: (versionId: string) => apiRequest("POST", `/api/qs5/versions/${versionId}/reopen`, { actor: checker, reason: "Reopened for revision" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/versions`] }),
  });

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700",
      under_review: "bg-yellow-100 text-yellow-700",
      approved: "bg-green-100 text-green-700",
      frozen: "bg-blue-100 text-blue-700",
      superseded: "bg-red-100 text-red-700",
    };
    return map[s] || "bg-gray-100 text-gray-700";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Create Version / Maker-Checker</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Maker (Estimator)</Label>
              <Input placeholder="Your name" value={maker} onChange={e => setMaker(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Checker (Reviewer)</Label>
              <Input placeholder="Reviewer name" value={checker} onChange={e => setChecker(e.target.value)} className="mt-1" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => createVersionMut.mutate()} disabled={!maker || !modelId} className="w-full">
                <Send className="w-4 h-4 mr-2" /> Create Version
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Version History</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-gray-500">Loading versions...</p>}
          {versions?.versions?.length === 0 && <p className="text-sm text-gray-500">No versions yet. Create the first version above.</p>}
          <div className="space-y-2">
            {(versions?.versions || []).map((v: any) => (
              <div key={v.versionId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-mono font-bold">v{v.versionNumber}</span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor(v.status)}`}>{v.status.replace("_", " ")}</span>
                  <span className="text-xs text-gray-500">${v.grandTotal?.toLocaleString() ?? "—"}</span>
                  <span className="text-xs text-gray-400">{v.maker}</span>
                </div>
                <div className="flex space-x-1">
                  {v.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => submitMut.mutate(v.versionId)}>
                      <Send className="w-3 h-3 mr-1" /> Submit
                    </Button>
                  )}
                  {v.status === "under_review" && (
                    <>
                      <Button size="sm" variant="outline" className="text-green-600" onClick={() => approveMut.mutate(v.versionId)}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600" onClick={() => rejectMut.mutate(v.versionId)}>
                        <XCircle className="w-3 h-3 mr-1" /> Reject
                      </Button>
                    </>
                  )}
                  {v.status === "approved" && (
                    <Button size="sm" variant="outline" className="text-blue-600" onClick={() => freezeMut.mutate(v.versionId)}>
                      <Lock className="w-3 h-3 mr-1" /> Freeze
                    </Button>
                  )}
                  {(v.status === "approved" || v.status === "frozen") && (
                    <Button size="sm" variant="outline" onClick={() => reopenMut.mutate(v.versionId)}>
                      <Unlock className="w-3 h-3 mr-1" /> Reopen
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Version Comparison</CardTitle></CardHeader>
        <CardContent>
          <div className="flex space-x-3 mb-3">
            <div>
              <Label className="text-xs">From Version</Label>
              <Input type="number" placeholder="1" value={diffFrom} onChange={e => setDiffFrom(e.target.value)} className="mt-1 w-24" />
            </div>
            <div>
              <Label className="text-xs">To Version</Label>
              <Input type="number" placeholder="2" value={diffTo} onChange={e => setDiffTo(e.target.value)} className="mt-1 w-24" />
            </div>
          </div>
          {diffData && (
            <div className="bg-gray-50 p-3 rounded-lg text-sm">
              <p className="font-medium">Grand Total Change: <span className={diffData.grandTotalChange >= 0 ? "text-red-600" : "text-green-600"}>${diffData.grandTotalChange?.toLocaleString()} ({diffData.grandTotalChangePercent}%)</span></p>
              <p className="text-gray-600 mt-1">Line items: {diffData.lineItemCountChange >= 0 ? "+" : ""}{diffData.lineItemCountChange}</p>
              {diffData.majorChanges?.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-xs text-gray-500 mb-1">Major Changes:</p>
                  {diffData.majorChanges.map((mc: any, i: number) => (
                    <p key={i} className="text-xs text-gray-600">Div {mc.csiDivision}: ${mc.change?.toLocaleString()} ({mc.changePercent}%)</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 2: DUAL CLASSIFICATION (UNIFORMAT, NRM, WBS)
// ═══════════════════════════════════════════════════════════════════════════════

function ClassificationTab({ modelId }: { modelId: string }) {
  const [subTab, setSubTab] = useState<"uniformat" | "divisions" | "crosswalk" | "wbs" | "reconciliation">("uniformat");

  const { data: uniformat } = useQuery<any>({
    queryKey: [`/api/qs5/models/${modelId}/uniformat`],
    enabled: !!modelId && subTab === "uniformat",
  });

  const { data: divisions } = useQuery<any>({
    queryKey: [`/api/qs5/models/${modelId}/divisions`],
    enabled: !!modelId && subTab === "divisions",
  });

  const { data: crosswalk } = useQuery<any>({
    queryKey: [`/api/qs5/crosswalk`],
    enabled: subTab === "crosswalk",
  });

  const { data: wbs } = useQuery<any>({
    queryKey: [`/api/qs5/wbs`],
    enabled: subTab === "wbs",
  });

  const { data: reconciliation } = useQuery<any>({
    queryKey: [`/api/qs5/models/${modelId}/reconciliation`],
    enabled: !!modelId && subTab === "reconciliation",
  });

  const subTabs = [
    { key: "uniformat",      label: "UNIFORMAT Summary" },
    { key: "divisions",      label: "CSI Divisions" },
    { key: "crosswalk",      label: "Cross-Walk Table" },
    { key: "wbs",            label: "WBS/CBS" },
    { key: "reconciliation", label: "Reconciliation" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex space-x-2 overflow-x-auto">
        {subTabs.map(st => (
          <Button key={st.key} size="sm" variant={subTab === st.key ? "default" : "outline"} onClick={() => setSubTab(st.key as any)}>
            {st.label}
          </Button>
        ))}
      </div>

      {subTab === "uniformat" && uniformat && (
        <Card>
          <CardHeader><CardTitle className="text-base">UNIFORMAT II Elemental Summary ({uniformat.count} elements)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">Code</th><th className="pb-2 pr-3">Element</th>
                  <th className="pb-2 pr-3 text-right">Material</th><th className="pb-2 pr-3 text-right">Labor</th>
                  <th className="pb-2 pr-3 text-right">Equipment</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">%</th>
                </tr></thead>
                <tbody>
                  {(uniformat.summary || []).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono text-xs">{r.level3Code}</td>
                      <td className="py-2 pr-3">{r.level3Name}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.materialTotal?.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.laborTotal?.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.equipmentTotal?.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono font-medium">${r.subtotal?.toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-500">{r.percentOfTotal}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "divisions" && divisions && (
        <Card>
          <CardHeader><CardTitle className="text-base">CSI Division Summary ({divisions.count} divisions)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">Div</th><th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3 text-right">Material</th><th className="pb-2 pr-3 text-right">Labor</th>
                  <th className="pb-2 pr-3 text-right">Equipment</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">%</th>
                </tr></thead>
                <tbody>
                  {(divisions.summary || []).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono font-bold">{r.csiDivision}</td>
                      <td className="py-2 pr-3">{r.csiDivisionName}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.materialTotal?.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.laborTotal?.toLocaleString()}</td>
                      <td className="py-2 pr-3 text-right font-mono">${r.equipmentTotal?.toLocaleString()}</td>
                      <td className="py-2 text-right font-mono font-medium">${r.subtotal?.toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-500">{r.percentOfTotal}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "crosswalk" && crosswalk && (
        <Card>
          <CardHeader><CardTitle className="text-base">CSI ↔ UNIFORMAT Cross-Walk Table</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-2">CSI</th><th className="pb-2 pr-2">Division</th>
                  <th className="pb-2 pr-2">UF L1</th><th className="pb-2 pr-2">UF L3</th>
                  <th className="pb-2 pr-2">NRM2</th><th className="pb-2">Measurement</th>
                </tr></thead>
                <tbody>
                  {(crosswalk.crosswalk || []).map((r: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 font-mono font-bold">{r.csiDivision}</td>
                      <td className="py-1.5 pr-2">{r.csiDivisionName}</td>
                      <td className="py-1.5 pr-2 font-mono">{r.uniformatLevel1}</td>
                      <td className="py-1.5 pr-2 font-mono">{r.uniformatLevel3}</td>
                      <td className="py-1.5 pr-2">{r.nrm2Ref}</td>
                      <td className="py-1.5">{r.measurementBasis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "wbs" && wbs && (
        <Card>
          <CardHeader><CardTitle className="text-base">WBS / CBS Default Structure ({wbs.count} nodes)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">WBS</th><th className="pb-2 pr-3">CBS</th>
                  <th className="pb-2 pr-3">CSI</th><th className="pb-2 pr-3">UF</th><th className="pb-2">Description</th>
                </tr></thead>
                <tbody>
                  {(wbs.wbs || []).map((n: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono">{n.wbsCode}</td>
                      <td className="py-2 pr-3 font-mono">{n.cbsCode}</td>
                      <td className="py-2 pr-3 font-mono font-bold">{n.csiDivision}</td>
                      <td className="py-2 pr-3 font-mono">{n.uniformatLevel1}</td>
                      <td className="py-2">{n.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "reconciliation" && reconciliation && (
        <Card>
          <CardHeader><CardTitle className="text-base">Element ↔ Division Reconciliation</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">CSI Total</p><p className="text-lg font-bold">${reconciliation.csiTotal?.toLocaleString()}</p></div>
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">UNIFORMAT Total</p><p className="text-lg font-bold">${reconciliation.uniformatTotal?.toLocaleString()}</p></div>
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Difference</p><p className="text-lg font-bold">${reconciliation.difference?.toLocaleString()}</p></div>
              <div className={`p-3 rounded-lg ${reconciliation.reconciled ? "bg-green-50" : "bg-red-50"}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${reconciliation.reconciled ? "text-green-700" : "text-red-700"}`}>
                  {reconciliation.reconciled ? "✓ Reconciled" : "✗ Discrepancy"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!modelId && (
        <Card><CardContent className="py-8 text-center text-gray-500">
          <p>Select a model to view classification data.</p>
        </CardContent></Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 3: BENCHMARKING & COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════════

function BenchmarkTab({ projectId, modelId, projectData }: { projectId: string; modelId: string; projectData?: any }) {
  const queryClient = useQueryClient();
  const [buildingType, setBuildingType] = useState(
    projectData?.type || "residential_lowrise"
  );
  // GFA initialised from project record if available — not hardcoded to Moorings 2500 m²
  const [gfa, setGfa] = useState(
    projectData?.buildingArea ? String(Math.round(parseFloat(projectData.buildingArea))) : ""
  );

  const { data: benchmarks } = useQuery<any>({ queryKey: [`/api/qs5/benchmarks`] });
  const { data: validationSummary } = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/validation-summary`] });

  const runBenchmark = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/benchmark`, { modelId, buildingType, grossFloorArea: parseFloat(gfa) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/validation-summary`] }),
  });

  const runCompleteness = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/completeness`, { modelId, buildingType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/validation-summary`] }),
  });

  const bm = validationSummary?.benchmark;
  const comp = validationSummary?.completeness;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Benchmark Configuration</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Building Type</Label>
              <Select value={buildingType} onValueChange={setBuildingType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(benchmarks?.benchmarks || []).map((b: any) => (
                    <SelectItem key={b.buildingType} value={b.buildingType}>{b.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">GFA (m²)</Label>
              <Input type="number" value={gfa} onChange={e => setGfa(e.target.value)} className="mt-1" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => runBenchmark.mutate()} disabled={!modelId} className="w-full">
                <BarChart3 className="w-4 h-4 mr-2" /> Run Benchmark
              </Button>
            </div>
            <div className="flex items-end">
              <Button onClick={() => runCompleteness.mutate()} disabled={!modelId} variant="outline" className="w-full">
                <Shield className="w-4 h-4 mr-2" /> Check Completeness
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {bm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Benchmark Comparison Results</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Your Cost/m²</p><p className="text-xl font-bold">${bm.costPerM2?.toLocaleString()}</p></div>
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Benchmark Low</p><p className="text-lg font-medium text-gray-600">${bm.benchmarkRange?.lowPerM2?.toLocaleString()}</p></div>
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Benchmark Mid</p><p className="text-lg font-medium text-gray-600">${bm.benchmarkRange?.midPerM2?.toLocaleString()}</p></div>
              <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Benchmark High</p><p className="text-lg font-medium text-gray-600">${bm.benchmarkRange?.highPerM2?.toLocaleString()}</p></div>
              <div className={`p-3 rounded-lg ${bm.status === "within_range" ? "bg-green-50" : bm.status === "above_range" ? "bg-red-50" : "bg-yellow-50"}`}>
                <p className="text-xs text-gray-500">Status</p>
                <p className={`text-lg font-bold ${bm.status === "within_range" ? "text-green-700" : bm.status === "above_range" ? "text-red-700" : "text-yellow-700"}`}>
                  {bm.status === "within_range" ? "✓ Within Range" : bm.status === "above_range" ? "↑ Above Range" : "↓ Below Range"}
                </p>
              </div>
            </div>
            {bm.flags?.length > 0 && bm.flags.map((f: string, i: number) => (
              <div key={i} className="flex items-start space-x-2 text-sm mt-1">
                <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span>{f}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {comp && (
        <Card>
          <CardHeader><CardTitle className="text-base">Division Completeness Check — Score: {comp.completenessScore}%</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Missing Required ({comp.missingRequired?.length})</p>
                {comp.missingRequired?.length > 0
                  ? <div className="flex flex-wrap gap-1">{comp.missingRequired.map((d: string) => <Badge key={d} variant="destructive" className="text-xs">Div {d}</Badge>)}</div>
                  : <Badge variant="outline" className="text-xs text-green-600">None — All Required Present</Badge>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Missing Typical ({comp.missingTypical?.length})</p>
                {comp.missingTypical?.length > 0
                  ? <div className="flex flex-wrap gap-1">{comp.missingTypical.map((d: string) => <Badge key={d} variant="outline" className="text-xs text-yellow-600">Div {d}</Badge>)}</div>
                  : <Badge variant="outline" className="text-xs text-green-600">None</Badge>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Data Quality</p>
                <p className="text-2xl font-bold">{comp.estimatedDataQuality}%</p>
              </div>
            </div>
            {comp.flags?.length > 0 && comp.flags.map((f: string, i: number) => (
              <div key={i} className="flex items-start space-x-2 text-sm mt-1">
                <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" /><span>{f}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 4: TRADE DATA (labor burden, rebar, vendor quotes, alternates)
// ═══════════════════════════════════════════════════════════════════════════════

function TradeDataTab({ projectId, modelId }: { projectId: string; modelId: string }) {
  const [subTab, setSubTab] = useState<"labor" | "rebar" | "quotes" | "alternates">("labor");

  const { data: laborData }     = useQuery<any>({ queryKey: [`/api/qs5/labor-burden`],                          enabled: subTab === "labor" });
  const { data: rebarData }     = useQuery<any>({ queryKey: [`/api/qs5/rebar`],                                 enabled: subTab === "rebar" });
  const { data: quotesData }    = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/quotes`],          enabled: subTab === "quotes" });
  const { data: alternatesData }= useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/alternates`],      enabled: subTab === "alternates" });

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        {(["labor", "rebar", "quotes", "alternates"] as const).map(st => (
          <Button key={st} size="sm" variant={subTab === st ? "default" : "outline"} onClick={() => setSubTab(st)}>
            {st === "labor" ? "Labor Burden" : st === "rebar" ? "Rebar / CSA G30.18" : st === "quotes" ? "Vendor Quotes" : "Alternates"}
          </Button>
        ))}
      </div>

      {subTab === "labor" && laborData && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Ontario Statutory Rates (Employer)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Code</th><th className="pb-2 pr-3">Description</th><th className="pb-2 text-right">Rate %</th>
                  </tr></thead>
                  <tbody>
                    {(laborData.statutoryRates || []).map((r: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-mono font-bold">{r.code}</td>
                        <td className="py-2 pr-3">{r.description}</td>
                        <td className="py-2 text-right font-mono">{r.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Union Trade Rates — {laborData.totalTrades} Trades (Avg Burden: {laborData.averageBurdenPercent}%)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-2">Trade</th><th className="pb-2 pr-2">Local</th>
                    <th className="pb-2 pr-2 text-right">Base $/hr</th><th className="pb-2 pr-2 text-right">H&W</th>
                    <th className="pb-2 pr-2 text-right">Pension</th><th className="pb-2 pr-2 text-right">Total Fringe</th>
                    <th className="pb-2 pr-2 text-right">Package</th><th className="pb-2 text-right">Burden %</th>
                  </tr></thead>
                  <tbody>
                    {(laborData.unionTradeRates || []).map((t: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1.5 pr-2 font-medium">{t.trade}</td>
                        <td className="py-1.5 pr-2 text-gray-500">{t.localUnion}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">${t.baseWage}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">${t.healthWelfare}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">${t.pension}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">${t.totalFringe}</td>
                        <td className="py-1.5 pr-2 text-right font-mono font-bold">${t.totalPackage}</td>
                        <td className="py-1.5 text-right font-mono">{t.burdenPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">WSIB Premium Rates by Trade</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Class</th><th className="pb-2 pr-3">Trade</th><th className="pb-2 text-right">$/100 Earnings</th>
                  </tr></thead>
                  <tbody>
                    {(laborData.wsibRatesByTrade || []).map((w: any, i: number) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-mono">{w.classCode}</td>
                        <td className="py-2 pr-3">{w.trade}</td>
                        <td className="py-2 text-right font-mono font-bold">${w.ratePerHundred}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {subTab === "rebar" && rebarData && (
        <Card>
          <CardHeader><CardTitle className="text-base">CSA G30.18 Rebar Specifications — Rate: ${rebarData.rateData?.totalRate}/kg</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">Size</th><th className="pb-2 pr-3 text-right">Ø mm</th>
                  <th className="pb-2 pr-3 text-right">Area mm²</th><th className="pb-2 pr-3 text-right">kg/m</th>
                  <th className="pb-2 pr-3">Grade</th><th className="pb-2">Lengths</th>
                </tr></thead>
                <tbody>
                  {(rebarData.specifications || []).map((s: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono font-bold">{s.designation}</td>
                      <td className="py-2 pr-3 text-right">{s.nominalDiameter}</td>
                      <td className="py-2 pr-3 text-right">{s.crossSectionalArea}</td>
                      <td className="py-2 pr-3 text-right">{s.massPerMetre}</td>
                      <td className="py-2 pr-3">{s.grade}</td>
                      <td className="py-2">{s.standardLengths?.join(", ")}m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "quotes" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Vendor Quotes ({quotesData?.count ?? 0})</CardTitle></CardHeader>
          <CardContent>
            {quotesData?.quotes?.length === 0
              ? <p className="text-sm text-gray-500">No vendor quotes yet.</p>
              : <div className="space-y-2">
                  {(quotesData?.quotes || []).map((q: any) => (
                    <div key={q.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{q.vendor}</p>
                        <p className="text-xs text-gray-500">{q.lineItemCode} — ${q.quotedAmount?.toLocaleString()}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={q.isBinding ? "default" : "outline"}>{q.isBinding ? "Binding" : "Budgetary"}</Badge>
                        <Badge variant={q.status === "active" ? "default" : "destructive"} className="text-xs">{q.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </CardContent>
        </Card>
      )}

      {subTab === "alternates" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Alternate / Option Pricing</CardTitle></CardHeader>
          <CardContent>
            {alternatesData?.alternates?.length === 0
              ? <p className="text-sm text-gray-500">No alternates defined.</p>
              : <div className="space-y-2">
                  {(alternatesData?.alternates || []).map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{a.alternateNumber}: {a.description}</p>
                        <p className="text-xs text-gray-500">{a.rationale}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant={a.type === "add" ? "default" : "outline"}>
                          {a.type === "add" ? "+" : "–"}${Math.abs(a.addDeductAmount)?.toLocaleString()}
                        </Badge>
                        <Badge variant={a.status === "accepted" ? "default" : "outline"} className="text-xs">{a.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 5: RISK & SIMULATION (Monte Carlo)
// ═══════════════════════════════════════════════════════════════════════════════

function RiskTab({ projectId, modelId }: { projectId: string; modelId: string }) {
  const queryClient = useQueryClient();
  const [iterations, setIterations] = useState("5000");

  const { data: mcResult } = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/monte-carlo`] });

  const runMC = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/monte-carlo`, {
      modelId, iterations: parseInt(iterations), confidenceLevels: [50, 80, 90, 95],
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/monte-carlo`] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Monte Carlo Simulation</CardTitle></CardHeader>
        <CardContent>
          <div className="flex space-x-3 mb-4">
            <div>
              <Label className="text-xs">Iterations</Label>
              <Input type="number" value={iterations} onChange={e => setIterations(e.target.value)} className="mt-1 w-32" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => runMC.mutate()} disabled={!modelId}>
                <RefreshCw className="w-4 h-4 mr-2" /> Run Simulation
              </Button>
            </div>
          </div>

          {mcResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Base Estimate</p><p className="text-lg font-bold">${mcResult.baseEstimate?.toLocaleString()}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Mean</p><p className="text-lg font-bold">${mcResult.mean?.toLocaleString()}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Std Dev</p><p className="text-lg font-medium">${mcResult.standardDeviation?.toLocaleString()}</p></div>
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs text-gray-500">Recommended Contingency</p>
                  <p className="text-lg font-bold text-blue-700">${mcResult.recommendedContingency?.toLocaleString()} ({mcResult.recommendedContingencyPercent}%)</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Confidence Levels</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(mcResult.confidenceLevels || []).map((cl: any) => (
                    <div key={cl.percentile} className="bg-gray-50 p-3 rounded-lg">
                      <p className="text-xs text-gray-500">P{cl.percentile}</p>
                      <p className="text-base font-bold">${cl.value?.toLocaleString()}</p>
                      <p className="text-xs text-gray-400">+${cl.contingencyFromBase?.toLocaleString()} ({cl.contingencyPercent}%)</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Distribution Histogram ({mcResult.iterations} iterations)</p>
                <div className="flex items-end space-x-0.5 h-32">
                  {(mcResult.histogram || []).map((bin: any, i: number) => {
                    const maxPct = Math.max(...(mcResult.histogram || []).map((b: any) => b.percentage));
                    const height = maxPct > 0 ? (bin.percentage / maxPct) * 100 : 0;
                    return (
                      <div key={i} className="bg-blue-500 rounded-t flex-1 min-w-1" style={{ height: `${height}%` }}
                        title={`$${bin.rangeStart?.toLocaleString()} – $${bin.rangeEnd?.toLocaleString()}: ${bin.percentage}%`} />
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>${mcResult.minimum?.toLocaleString()}</span>
                  <span>${mcResult.maximum?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 6: SCHEDULE OF VALUES
// ═══════════════════════════════════════════════════════════════════════════════

function SOVTab({ projectId, modelId, projectName }: { projectId: string; modelId: string; projectName: string }) {
  const queryClient = useQueryClient();

  const { data: sov }   = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/sov`] });
  const { data: certs } = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/sov/certificates`] });

  const generateSOV = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/sov`, {
      modelId, retainagePercent: 10, projectName,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/sov`] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Schedule of Values (CCDC 2)</CardTitle>
            <div className="flex space-x-2">
              <Button size="sm" onClick={() => generateSOV.mutate()} disabled={!modelId}>Generate SOV</Button>
              {sov && (
                <Button size="sm" variant="outline" onClick={async () => {
                  try {
                    const resp = await apiRequest("GET", `/api/qs5/projects/${projectId}/sov.csv`);
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "sov.csv";
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                  } catch (err) { console.error("SOV CSV export failed:", err); }
                }}>
                  <Download className="w-3 h-3 mr-1" /> CSV
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sov ? (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Scheduled Value</p><p className="text-lg font-bold">${sov.subtotalScheduledValue?.toLocaleString()}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Retainage (10%)</p><p className="text-lg font-medium text-red-600">${sov.totalRetainage?.toLocaleString()}</p></div>
                <div className="bg-green-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Net Payable</p><p className="text-lg font-bold text-green-700">${sov.netPayable?.toLocaleString()}</p></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-2">#</th><th className="pb-2 pr-2">Div</th><th className="pb-2 pr-2">Description</th>
                    <th className="pb-2 pr-2 text-right">Material</th><th className="pb-2 pr-2 text-right">Labor</th>
                    <th className="pb-2 text-right">Scheduled</th><th className="pb-2 text-right">%</th>
                  </tr></thead>
                  <tbody>
                    {(sov.items || []).map((item: any) => (
                      <tr key={item.itemNumber} className="border-b border-gray-100">
                        <td className="py-2 pr-2 font-mono text-xs">{item.itemNumber}</td>
                        <td className="py-2 pr-2 font-mono font-bold">{item.csiDivision}</td>
                        <td className="py-2 pr-2">{item.csiDivisionName}</td>
                        <td className="py-2 pr-2 text-right font-mono">${item.materialValue?.toLocaleString()}</td>
                        <td className="py-2 pr-2 text-right font-mono">${item.laborValue?.toLocaleString()}</td>
                        <td className="py-2 text-right font-mono font-medium">${item.scheduledValue?.toLocaleString()}</td>
                        <td className="py-2 text-right text-gray-500">{item.percentOfTotal}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No SOV generated yet. Click "Generate SOV" above.</p>
          )}
        </CardContent>
      </Card>

      {certs?.certificates?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Progress Certificates ({certs.certificates.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {certs.certificates.map((c: any) => (
                <div key={c.certificateNumber} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">Certificate {c.certificateNumber}</p>
                    <p className="text-xs text-gray-500">Period ending: {c.periodEnding}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">${c.netPayableThisPeriod?.toLocaleString()}</p>
                    <p className="text-xs text-gray-500">Retainage held: ${c.totalRetainageHeld?.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 7: BASIS OF ESTIMATE
// ═══════════════════════════════════════════════════════════════════════════════

function BoETab({ projectId, modelId, projectName, projectData }: { projectId: string; modelId: string; projectName: string; projectData?: any }) {
  const queryClient = useQueryClient();
  const [preparedBy, setPreparedBy] = useState("");
  const [preparedFor, setPreparedFor] = useState("");

  const { data: boe } = useQuery<any>({ queryKey: [`/api/qs5/projects/${projectId}/boe`] });

  const generateBoE = useMutation({
    mutationFn: () => apiRequest("POST", `/api/qs5/projects/${projectId}/boe`, {
      modelId,
      projectName,
      preparedBy: preparedBy || "EstimatorPro v3",
      preparedFor: preparedFor || "Project Owner",
      revision: "Rev 0",
      location: projectData?.location || `[LOCATION — RFI REQUIRED: project "${projectId}" not loaded]`,
      owner: "Project Owner",
      buildingType: projectData?.type || `[BUILDING TYPE — RFI REQUIRED: project "${projectId}" not loaded]`,
      grossFloorArea: projectData?.buildingArea ? parseFloat(projectData.buildingArea) : undefined,
      numberOfStoreys: undefined, // Resolved from BIM model storeys — not hardcoded
      constructionType: `[CONSTRUCTION TYPE — RFI REQUIRED: specify per specifications]`,
      projectDuration: `[DURATION — RFI REQUIRED: specify per project schedule]`,
      scopeDescription: `New construction — ${projectName || '[RFI: project name required]'}`,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/qs5/projects/${projectId}/boe`] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Basis of Estimate (AACE RP 34R-05)</CardTitle>
            <div className="flex space-x-2">
              <Button size="sm" onClick={() => generateBoE.mutate()} disabled={!modelId}>
                <FileText className="w-4 h-4 mr-2" /> Generate BoE
              </Button>
              {boe && (
                <Button size="sm" variant="outline" onClick={async () => {
                  try {
                    const resp = await apiRequest("GET", `/api/qs5/projects/${projectId}/boe?format=text`);
                    const blob = await resp.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "basis-of-estimate.txt";
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                  } catch (err) { console.error("BoE export failed:", err); }
                }}>
                  <Download className="w-3 h-3 mr-1" /> Text Export
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <Label className="text-xs">Prepared By</Label>
              <Input value={preparedBy} onChange={e => setPreparedBy(e.target.value)} placeholder="Estimator name" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Prepared For</Label>
              <Input value={preparedFor} onChange={e => setPreparedFor(e.target.value)} placeholder="Client name" className="mt-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      {boe && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Executive Summary — {boe.estimateClass}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 mb-3">{boe.executiveSummary?.purpose}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Headline Total</p><p className="text-lg font-bold">${boe.executiveSummary?.headlineTotal?.toLocaleString()}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Cost/m²</p><p className="text-lg font-medium">${boe.executiveSummary?.costPerM2?.toLocaleString()}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Scope Maturity</p><p className="text-lg font-medium">{boe.executiveSummary?.scopeMaturityPercent}%</p></div>
                <div className="bg-blue-50 p-3 rounded-lg"><p className="text-xs text-gray-500">AACE Class</p><p className="text-lg font-bold text-blue-700">{boe.estimateClass}</p></div>
              </div>
              {boe.executiveSummary?.keyHighlights?.map((h: string, i: number) => (
                <div key={i} className="flex items-center space-x-2 text-sm mb-1">
                  <ChevronRight className="w-3 h-3 text-blue-500" /><span>{h}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Methodology</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(boe.methodology || {}).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="text-sm">
                  <span className="font-medium text-gray-600">{k.replace(/([A-Z])/g, " $1").trim()}: </span>
                  <span>{v as string}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Assumptions ({boe.assumptions?.length})</CardTitle></CardHeader>
            <CardContent>
              {(boe.assumptions || []).map((a: any) => (
                <div key={a.id} className="flex items-start space-x-2 text-sm mb-2">
                  <Badge variant="outline" className="text-xs flex-shrink-0">{a.category}/{a.impact}</Badge>
                  <span>{a.description}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {boe.benchmarkComparison && (
            <Card>
              <CardHeader><CardTitle className="text-base">Benchmark Comparison</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm">
                  Cost/m²: <span className="font-bold">${boe.benchmarkComparison.costPerM2}</span> —
                  Range: ${boe.benchmarkComparison.benchmarkLow} – ${boe.benchmarkComparison.benchmarkHigh} —
                  Status: <span className="font-bold">{boe.benchmarkComparison.status}</span>
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Approval Sign-off</CardTitle></CardHeader>
            <CardContent>
              {(boe.approvalSignoff || []).map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-2 border-b border-gray-100">
                  <div>
                    <span className="font-medium text-sm">{a.role}</span>
                    <span className="text-sm text-gray-500 ml-2">{a.name}</span>
                  </div>
                  <Badge variant={a.status === "signed" ? "default" : "outline"}>{a.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TAB 8: ESTIMATE ENGINE  — /api/estimates/:modelId/*
// ═══════════════════════════════════════════════════════════════════════════════
//
//  H-3 — wires 22 previously unreachable estimator-router endpoints.
//  All field names verified against actual source interfaces before writing.
//  No defaults. Missing data surfaces as empty states, never invented values.
//
//  Sub-tab     Endpoint(s)                              Source interface
//  ─────────── ──────────────────────────────────────── ─────────────────────────────
//  full        GET  /api/estimates/:id/full             EstimateSummary + BudgetStructure
//  budget      GET  /api/estimates/:id/budget           BudgetStructure (8 tiers)
//  uniformat   GET  /api/estimates/:id/uniformat        crossWalk[] + dualSummary
//  codes       GET  /api/estimates/:id/codes            register + adderResults
//  labor       GET  /api/estimates/:id/labor            LaborBurdenSummary
//  wbs         GET  /api/estimates/:id/wbs              WBSStructure nodes[]
//  rebar       GET  /api/estimates/:id/rebar            RebarSummary + concreteElementsFound
//  variants    GET  /api/estimates/:id/variants         RateVariantSummary + report
//  nrm2        GET  /api/estimates/:id/nrm2             MeasuredEstimate + report
//  snapshots   GET  /api/estimates/:id/history          snapshotCount + snapshots[]
//              POST /api/estimates/:id/snapshot         description + createdBy + status
//  rfis        GET  /api/estimates/:id/rfis             rfiCount + rfis[]
//              POST /api/estimates/:id/rfis             items: MissingDataItem[]
//  quotes      GET  /api/estimates/:id/quotes           register.totalQuotes + quotes[]
//              POST /api/estimates/:id/quotes           vendorName + csiDivision (required)
//  alternates  GET  /api/estimates/:id/alternates       summary + alternates[]
//              POST /api/estimates/:id/alternates       description + alternateCost (required)
//  bidleveling POST /api/estimates/:id/bid-leveling     BidLevelingReport
//  status      GET  /api/estimator/status               engine health + inMemoryStores

type EngineSubTab =
  | "full" | "budget" | "uniformat" | "codes" | "labor"
  | "wbs" | "rebar" | "variants" | "nrm2"
  | "snapshots" | "rfis" | "quotes" | "alternates"
  | "bidleveling" | "status"
  | "boe-engine" | "sov-engine" | "benchmark-engine"
  | "montecarlo" | "boq-costs" | "cost-estimate" | "cost-update";

const ENGINE_TABS: { key: EngineSubTab; label: string }[] = [
  { key: "full",               label: "Full Estimate"     },
  { key: "budget",             label: "Budget Tiers"      },
  { key: "uniformat",          label: "UNIFORMAT"         },
  { key: "codes",              label: "Codes Register"    },
  { key: "labor",              label: "Labor Rates"       },
  { key: "wbs",                label: "WBS/CBS"           },
  { key: "rebar",              label: "Rebar"             },
  { key: "variants",           label: "Rate Variants"     },
  { key: "nrm2",               label: "NRM2"              },
  { key: "snapshots",          label: "Snapshots"         },
  { key: "rfis",               label: "RFIs"              },
  { key: "quotes",             label: "Quote Register"    },
  { key: "alternates",         label: "Alternates"        },
  { key: "bidleveling",        label: "Bid Leveling"      },
  { key: "boe-engine",         label: "Basis of Estimate" },
  { key: "sov-engine",         label: "SOV"               },
  { key: "benchmark-engine",   label: "Benchmark"         },
  { key: "montecarlo",         label: "Monte Carlo"       },
  { key: "boq-costs",          label: "BOQ + Costs"       },
  { key: "cost-estimate",      label: "Cost Estimate"     },
  { key: "cost-update",        label: "Cost Update"       },
  { key: "status",             label: "Engine Status"     },
];

function EstimateEngineTab({ projectId, modelId, projectName }: { projectId: string; modelId: string; projectName: string }) {
  const [subTab, setSubTab] = useState<EngineSubTab>("full");

  const projectOnlyTabs: EngineSubTab[] = ["boq-costs", "cost-estimate", "cost-update"];
  const noModelNeeded = subTab === "status" || projectOnlyTabs.includes(subTab);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {ENGINE_TABS.map(st => (
          <Button key={st.key} size="sm"
            variant={subTab === st.key ? "default" : "outline"}
            onClick={() => setSubTab(st.key)}
          >
            {st.label}
          </Button>
        ))}
      </div>

      {!modelId && !noModelNeeded && (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            <Cpu className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-medium">No model selected</p>
            <p className="text-xs mt-1">Navigate to a project with a BIM model to use the Estimate Engine.</p>
          </CardContent>
        </Card>
      )}

      {subTab === "full"             && modelId && <EngineFullTab            modelId={modelId} />}
      {subTab === "budget"           && modelId && <EngineBudgetTab          modelId={modelId} />}
      {subTab === "uniformat"        && modelId && <EngineUniformatTab       modelId={modelId} />}
      {subTab === "codes"            && modelId && <EngineCodesTab           modelId={modelId} />}
      {subTab === "labor"            && modelId && <EngineLaborTab           modelId={modelId} />}
      {subTab === "wbs"              && modelId && <EngineWbsTab             modelId={modelId} />}
      {subTab === "rebar"            && modelId && <EngineRebarTab           modelId={modelId} />}
      {subTab === "variants"         && modelId && <EngineVariantsTab        modelId={modelId} />}
      {subTab === "nrm2"             && modelId && <EngineNrm2Tab            modelId={modelId} />}
      {subTab === "snapshots"        && modelId && <EngineSnapshotsTab       modelId={modelId} />}
      {subTab === "rfis"             && modelId && <EngineRfisTab            modelId={modelId} projectName={projectName} />}
      {subTab === "quotes"           && modelId && <EngineQuotesTab          modelId={modelId} />}
      {subTab === "alternates"       && modelId && <EngineAlternatesTab      modelId={modelId} />}
      {subTab === "bidleveling"      && modelId && <EngineBidLevelTab        modelId={modelId} />}
      {subTab === "boe-engine"       && modelId && <EngineBoeTab             modelId={modelId} />}
      {subTab === "sov-engine"       && modelId && <EngineSovEngineTab       modelId={modelId} />}
      {subTab === "benchmark-engine" && modelId && <EngineBenchmarkEngineTab modelId={modelId} />}
      {subTab === "montecarlo"       && modelId && <EngineMonteCarloTab      modelId={modelId} />}
      {subTab === "boq-costs"                   && <EngineBoqCostsTab        projectId={projectId} />}
      {subTab === "cost-estimate"               && <EngineCostEstimateTab    projectId={projectId} />}
      {subTab === "cost-update"                 && <EngineCostUpdateTab      projectId={projectId} />}
      {subTab === "status"                      && <EngineStatusTab />}
    </div>
  );
}

// ─── ENGINE: FULL ESTIMATE ──────────────────────────────────────────────────
// GET /api/estimates/:modelId/full
// Response: { estimate: EstimateSummary, budget: BudgetStructure }
// estimate: .grandTotal, .lineItemCount, .floors[].floorLabel, .floorTotal,
//           .lineItems[].csiCode, .description, .unit, .quantity,
//           .totalCost, .laborCost, .materialCost, .equipmentCost
// budget:   .GRAND_TOTAL, .aaceClass.className, .aaceClass.estimateClass,
//           .directCost.subtotal, .generalConditions.subtotal,
//           .contingency.totalContingency

function EngineFullTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/full`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Running estimate engine…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load estimate.</p>;
  if (!data)     return null;
  const { estimate, budget } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Full Estimate — {budget?.aaceClass?.className}</CardTitle>
            <Badge variant="outline">{budget?.aaceClass?.estimateClass ? `Class ${budget.aaceClass.estimateClass}` : ""}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Direct Cost</p><p className="text-lg font-bold">${budget?.directCost?.subtotal?.toLocaleString()}</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">General Conditions</p><p className="text-lg font-medium">${budget?.generalConditions?.subtotal?.toLocaleString()}</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Contingency</p><p className="text-lg font-medium">${budget?.contingency?.totalContingency?.toLocaleString()}</p></div>
            <div className="bg-blue-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Grand Total (incl. HST)</p><p className="text-xl font-bold text-blue-700">${budget?.GRAND_TOTAL?.toLocaleString()}</p></div>
          </div>
          <p className="text-xs text-gray-400">{estimate?.lineItemCount} line items · {estimate?.floors?.length} floors</p>
        </CardContent>
      </Card>

      {(estimate?.floors || []).map((floor: any) => (
        <Card key={floor.floorLabel}>
          <CardHeader><CardTitle className="text-base">{floor.floorLabel} — ${floor.floorTotal?.toLocaleString()}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-2">CSI</th><th className="pb-2 pr-2">Description</th>
                    <th className="pb-2 pr-2 text-right">Qty</th><th className="pb-2 pr-2">Unit</th>
                    <th className="pb-2 pr-2 text-right">Material</th><th className="pb-2 pr-2 text-right">Labor</th>
                    <th className="pb-2 pr-2 text-right">Equip</th><th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(floor.lineItems || []).map((item: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 font-mono font-bold">{item.csiCode}</td>
                      <td className="py-1.5 pr-2">{item.description}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">{item.quantity?.toFixed(2)}</td>
                      <td className="py-1.5 pr-2 text-gray-500">{item.unit}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${item.materialCost?.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${item.laborCost?.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${item.equipmentCost?.toLocaleString()}</td>
                      <td className="py-1.5 text-right font-mono font-medium">${item.totalCost?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── ENGINE: BUDGET 8-TIER ──────────────────────────────────────────────────
// GET /api/estimates/:modelId/budget
// Response: { budget: BudgetStructure, summary }
// BudgetStructure layers verified from budget-structure.ts:
//   directCost.subtotal/.lineItemCount/.csiDivisionsUsed
//   generalConditions.subtotal/.percentOfDirect
//   designFees.subtotal/.percentOfConstruction
//   allowances.subtotal/.items[]
//   contingency.totalContingency/.percentOfBase
//   escalation.amount/.compoundFactor/.percentOfBase
//   permitsFees.subtotal
//   overheadProfit.subtotal/.percentOfConstruction
//   taxes.HST/.rate
//   GRAND_TOTAL, aaceClass.className

function EngineBudgetTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/budget`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Building budget structure…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load budget.</p>;
  if (!data)     return null;
  const b = data.budget;
  const layers = [
    { label: "Layer 1 — Direct Costs",       value: b?.directCost?.subtotal,          detail: `${b?.directCost?.lineItemCount} items · ${b?.directCost?.csiDivisionsUsed} CSI divisions` },
    { label: "Layer 2 — General Conditions", value: b?.generalConditions?.subtotal,   detail: `${b?.generalConditions?.percentOfDirect}% of direct` },
    { label: "Layer 3 — Design Fees",        value: b?.designFees?.subtotal,          detail: `${b?.designFees?.percentOfConstruction}% of construction` },
    { label: "Layer 4 — Allowances",         value: b?.allowances?.subtotal,          detail: `${b?.allowances?.items?.length ?? 0} allowance items` },
    { label: "Layer 5 — Contingency",        value: b?.contingency?.totalContingency, detail: `${b?.contingency?.percentOfBase}% of base` },
    { label: "Layer 6 — Escalation",         value: b?.escalation?.amount,            detail: `Compound factor ${b?.escalation?.compoundFactor?.toFixed(4)} (${b?.escalation?.percentOfBase}%)` },
    { label: "Layer 7 — Permits & Fees",     value: b?.permitsFees?.subtotal,         detail: "Building permit + development charges + inspections" },
    { label: "Layer 8 — Overhead & Profit",  value: b?.overheadProfit?.subtotal,      detail: `${b?.overheadProfit?.percentOfConstruction}% of construction` },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">8-Tier Budget Structure (CIQS)</CardTitle>
            <Badge variant="outline">{b?.aaceClass?.className}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {layers.map((layer, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{layer.label}</p>
                  <p className="text-xs text-gray-500">{layer.detail}</p>
                </div>
                <p className="text-sm font-bold font-mono">${layer.value?.toLocaleString() ?? "—"}</p>
              </div>
            ))}
            <Separator />
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium">HST ({(b?.taxes?.rate * 100)?.toFixed(0)}%)</p>
              <p className="text-sm font-bold font-mono">${b?.taxes?.HST?.toLocaleString()}</p>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-base font-bold">Grand Total (CAD, incl. HST)</p>
              <p className="text-xl font-bold text-blue-700">${b?.GRAND_TOTAL?.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      {data.summary && (
        <Card>
          <CardHeader><CardTitle className="text-base">Budget Summary Report</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded overflow-x-auto">{data.summary}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── ENGINE: UNIFORMAT ──────────────────────────────────────────────────────
// GET /api/estimates/:modelId/uniformat
// Response: { modelId, dualSummary, crossWalk[], report }
// crossWalk[].csiDivision, .csiDivisionName, .uniformatLevel1, .uniformatLevel3, .totalCost

function EngineUniformatTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/uniformat`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Generating UNIFORMAT summary…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load UNIFORMAT data.</p>;
  if (!data)     return null;

  return (
    <div className="space-y-4">
      {data.crossWalk?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">CSI ↔ UNIFORMAT Cross-Walk ({data.crossWalk.length} mappings)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-2">CSI</th><th className="pb-2 pr-2">Division Name</th>
                    <th className="pb-2 pr-2">UF Level 1</th><th className="pb-2 pr-2">UF Level 3</th>
                    <th className="pb-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.crossWalk || []).map((row: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 font-mono font-bold">{row.csiDivision}</td>
                      <td className="py-1.5 pr-2">{row.csiDivisionName}</td>
                      <td className="py-1.5 pr-2 font-mono">{row.uniformatLevel1}</td>
                      <td className="py-1.5 pr-2 font-mono">{row.uniformatLevel3}</td>
                      <td className="py-1.5 text-right font-mono">${row.totalCost?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {data.report && (
        <Card>
          <CardHeader><CardTitle className="text-base">Dual Summary Report</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded overflow-x-auto">{data.report}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── ENGINE: CODES REGISTER ─────────────────────────────────────────────────
// GET /api/estimates/:modelId/codes
// Response: { modelId, register, adderResults }
// register: .province, .buildingType, .nbcEdition, .obcEdition, .energyCode, .standards[]
// adderResults: .totalAdded, .adderCount,
//   .appliedAdders[].code, .description, .applicability, .amount

function EngineCodesTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/codes`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Building codes register…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load codes register.</p>;
  if (!data)     return null;
  const reg    = data.register;
  const adders = data.adderResults;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Codes & Standards Register — {reg?.province} / {reg?.buildingType}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">NBC Edition</p><p className="font-bold">{reg?.nbcEdition}</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">OBC Edition</p><p className="font-bold">{reg?.obcEdition}</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Energy Standard</p><p className="font-bold">{reg?.energyCode}</p></div>
            <div className={`p-3 rounded-lg ${adders?.totalAdded > 0 ? "bg-yellow-50" : "bg-green-50"}`}>
              <p className="text-xs text-gray-500">Code Adders Total</p>
              <p className="font-bold">${adders?.totalAdded?.toLocaleString()}</p>
            </div>
          </div>
          {adders?.appliedAdders?.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Code</th><th className="pb-2 pr-3">Description</th>
                    <th className="pb-2 pr-3">Applicability</th><th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {adders.appliedAdders.map((a: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono font-bold text-xs">{a.code}</td>
                      <td className="py-2 pr-3">{a.description}</td>
                      <td className="py-2 pr-3 text-gray-500 text-xs">{a.applicability}</td>
                      <td className="py-2 text-right font-mono">${a.amount?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {reg?.standards?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Referenced Standards ({reg.standards.length})</p>
              <div className="flex flex-wrap gap-2">
                {reg.standards.map((s: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: LABOR RATES ────────────────────────────────────────────────────
// GET /api/estimates/:modelId/labor
// Response: { modelId, summary: LaborBurdenSummary }
// summary: .totalTrades, .averageBurdenPercent, .statutoryRates[],
//   .unionTradeRates[].trade, .localUnion, .baseWage, .healthWelfare,
//   .pension, .totalFringe, .totalPackage, .burdenPercent

function EngineLaborTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/labor`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Loading labor rates…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load labor data.</p>;
  if (!data)     return null;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Loaded Labor Rates — {s?.totalTrades} Trades · Avg Burden {s?.averageBurdenPercent}%</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-2">Trade</th><th className="pb-2 pr-2">Local</th>
                  <th className="pb-2 pr-2 text-right">Base $/hr</th><th className="pb-2 pr-2 text-right">H&W</th>
                  <th className="pb-2 pr-2 text-right">Pension</th><th className="pb-2 pr-2 text-right">Total Fringe</th>
                  <th className="pb-2 pr-2 text-right">Package</th><th className="pb-2 text-right">Burden %</th>
                </tr>
              </thead>
              <tbody>
                {(s?.unionTradeRates || []).map((t: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5 pr-2 font-medium">{t.trade}</td>
                    <td className="py-1.5 pr-2 text-gray-500">{t.localUnion}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">${t.baseWage}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">${t.healthWelfare}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">${t.pension}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">${t.totalFringe}</td>
                    <td className="py-1.5 pr-2 text-right font-mono font-bold">${t.totalPackage}</td>
                    <td className="py-1.5 text-right font-mono">{t.burdenPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: WBS/CBS ────────────────────────────────────────────────────────
// GET /api/estimates/:modelId/wbs
// Response: { modelId, structure }
// structure: .projectName, .projectCode,
//   .nodes[].wbsCode, .cbsCode, .csiDivision, .uniformatLevel1,
//   .description, .totalCost

function EngineWbsTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/wbs`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Building WBS/CBS structure…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load WBS data.</p>;
  if (!data)     return null;
  const structure = data.structure;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">WBS/CBS — {structure?.projectName} ({structure?.projectCode})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">WBS</th><th className="pb-2 pr-3">CBS</th>
                  <th className="pb-2 pr-3">CSI</th><th className="pb-2 pr-3">UF L1</th>
                  <th className="pb-2 pr-3">Description</th><th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(structure?.nodes || []).map((n: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-mono">{n.wbsCode}</td>
                    <td className="py-2 pr-3 font-mono">{n.cbsCode}</td>
                    <td className="py-2 pr-3 font-mono font-bold">{n.csiDivision}</td>
                    <td className="py-2 pr-3 font-mono">{n.uniformatLevel1}</td>
                    <td className="py-2 pr-3">{n.description}</td>
                    <td className="py-2 text-right font-mono">${n.totalCost?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: REBAR DENSITY ──────────────────────────────────────────────────
// GET /api/estimates/:modelId/rebar
// Response: { modelId, summary, concreteElementsFound }
// summary: .projectName, .seismicZone, .totalConcreteVolume, .totalRebarMass,
//   .overallRebarDensity, .rateData.totalRate,
//   .elements[].elementType, .concreteVolume, .rebarMass, .density

function EngineRebarTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/rebar`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Calculating rebar densities…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load rebar data.</p>;
  if (!data)     return null;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rebar Density — {s?.projectName} · {s?.seismicZone} seismic · {data.concreteElementsFound} concrete elements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Total Concrete</p><p className="text-lg font-bold">{s?.totalConcreteVolume?.toFixed(1)} m³</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Total Rebar</p><p className="text-lg font-bold">{s?.totalRebarMass?.toFixed(0)} kg</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Overall Density</p><p className="text-lg font-bold">{s?.overallRebarDensity?.toFixed(1)} kg/m³</p></div>
            <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Rate $/kg</p><p className="text-lg font-bold">${s?.rateData?.totalRate}</p></div>
          </div>
          {s?.elements?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Element Type</th>
                    <th className="pb-2 pr-3 text-right">Concrete (m³)</th>
                    <th className="pb-2 pr-3 text-right">Rebar (kg)</th>
                    <th className="pb-2 text-right">Density (kg/m³)</th>
                  </tr>
                </thead>
                <tbody>
                  {s.elements.map((el: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3">{el.elementType}</td>
                      <td className="py-2 pr-3 text-right font-mono">{el.concreteVolume?.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{el.rebarMass?.toFixed(0)}</td>
                      <td className="py-2 text-right font-mono">{el.density?.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: RATE VARIANTS ──────────────────────────────────────────────────
// GET /api/estimates/:modelId/variants
// Response: { modelId, summary: RateVariantSummary, report }
// summary: .lowTotal, .midTotal, .highTotal, .pertTotal,
//   .estimateRange, .estimateRangePercent, .standardDeviation,
//   .confidenceInterval68.low/.high, .aaceClassRange,
//   .divisionSummary[].division, .divisionName, .lowCost, .midCost,
//   .highCost, .pertCost, .spread

function EngineVariantsTab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/variants`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Generating PERT 3-point variants…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load rate variants.</p>;
  if (!data)     return null;
  const s = data.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">PERT 3-Point Rate Variance</CardTitle>
            {s?.aaceClassRange && <Badge variant="outline" className="text-xs">{s.aaceClassRange}</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="bg-green-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Optimistic (Low)</p><p className="text-lg font-bold text-green-700">${s?.lowTotal?.toLocaleString()}</p></div>
            <div className="bg-blue-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Most Likely (Mid)</p><p className="text-lg font-bold text-blue-700">${s?.midTotal?.toLocaleString()}</p></div>
            <div className="bg-orange-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Pessimistic (High)</p><p className="text-lg font-bold text-orange-700">${s?.highTotal?.toLocaleString()}</p></div>
            <div className="bg-purple-50 p-3 rounded-lg"><p className="text-xs text-gray-500">PERT Weighted</p><p className="text-lg font-bold text-purple-700">${s?.pertTotal?.toLocaleString()}</p></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <div><p className="text-xs text-gray-500">Range</p><p className="font-medium">${s?.estimateRange?.toLocaleString()} ({s?.estimateRangePercent?.toFixed(1)}%)</p></div>
            <div><p className="text-xs text-gray-500">Std Deviation (σ)</p><p className="font-medium">${s?.standardDeviation?.toLocaleString()}</p></div>
            <div><p className="text-xs text-gray-500">68% CI (±1σ)</p><p className="font-medium">${s?.confidenceInterval68?.low?.toLocaleString()} – ${s?.confidenceInterval68?.high?.toLocaleString()}</p></div>
          </div>
          {s?.divisionSummary?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 pr-2">Div</th><th className="pb-2 pr-2">Name</th>
                    <th className="pb-2 pr-2 text-right">Low</th><th className="pb-2 pr-2 text-right">Mid</th>
                    <th className="pb-2 pr-2 text-right">High</th><th className="pb-2 pr-2 text-right">PERT</th>
                    <th className="pb-2 text-right">Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {s.divisionSummary.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-2 font-mono font-bold">{d.division}</td>
                      <td className="py-1.5 pr-2">{d.divisionName}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${d.lowCost?.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${d.midCost?.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${d.highCost?.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">${d.pertCost?.toLocaleString()}</td>
                      <td className="py-1.5 text-right font-mono text-orange-600">${d.spread?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: NRM2 MEASUREMENT ───────────────────────────────────────────────
// GET /api/estimates/:modelId/nrm2
// Response: { modelId, measured: MeasuredEstimate, report }
// measured.measurementSummary: .totalLineItems, .byBasis{},
//   .byNRM1Group[].group, .name, .count, .subtotal
// measured.measurementStandard: "RICS NRM2 (2nd edition)"

function EngineNrm2Tab({ modelId }: { modelId: string }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/nrm2`],
    enabled: !!modelId,
  });
  if (isLoading) return <p className="text-sm text-gray-500 p-4">Annotating with NRM2 rules…</p>;
  if (error)     return <p className="text-sm text-red-500 p-4">Failed to load NRM2 data.</p>;
  if (!data)     return null;
  const measured = data.measured;
  const ms = measured?.measurementSummary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">RICS NRM2 Measurement Annotations — {ms?.totalLineItems} line items</CardTitle>
            <Badge variant="outline" className="text-xs">{measured?.measurementStandard}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {ms?.byNRM1Group?.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">NRM1 Group</th><th className="pb-2 pr-3">Name</th>
                    <th className="pb-2 pr-3 text-right">Items</th><th className="pb-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {ms.byNRM1Group.map((g: any, i: number) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-mono font-bold">{g.group}</td>
                      <td className="py-2 pr-3">{g.name}</td>
                      <td className="py-2 pr-3 text-right">{g.count}</td>
                      <td className="py-2 text-right font-mono">${g.subtotal?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ms?.byBasis && (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(ms.byBasis).map(([basis, count]) => (
                <Badge key={basis} variant="outline" className="text-xs">{basis}: {count as number}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {data.report && (
        <Card>
          <CardHeader><CardTitle className="text-base">NRM2 Measurement Report</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded overflow-x-auto">{data.report}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── ENGINE: SNAPSHOTS ──────────────────────────────────────────────────────
// GET  /api/estimates/:modelId/history
//   Response: { modelId, snapshotCount, snapshots[].id, .revision,
//               .description, .status, .createdAt, .grandTotal, .lineItemCount }
// POST /api/estimates/:modelId/snapshot
//   Body: { description, createdBy, status, projectQuantity, measurementUnit }

function EngineSnapshotsTab({ modelId }: { modelId: string }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [createdBy, setCreatedBy]     = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/history`],
    enabled: !!modelId,
  });

  const createSnap = useMutation({
    mutationFn: () => apiRequest("POST", `/api/estimates/${modelId}/snapshot`, {
      description: description || "Manual snapshot",
      createdBy:   createdBy   || "EstimatorPro UI",
      status: "draft",
      // projectQuantity intentionally omitted — must come from BIM model data, not hardcoded
      measurementUnit: "m²",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${modelId}/history`] });
      setDescription("");
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Create Estimate Snapshot</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label className="text-xs">Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Pre-tender freeze" className="mt-1" /></div>
            <div><Label className="text-xs">Created By</Label><Input value={createdBy} onChange={e => setCreatedBy(e.target.value)} placeholder="Estimator name" className="mt-1" /></div>
            <div className="flex items-end">
              <Button onClick={() => createSnap.mutate()} disabled={!modelId} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />Snapshot Now
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Snapshot History — {data?.snapshotCount ?? 0} snapshots</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {data?.snapshotCount === 0 && <p className="text-sm text-gray-500">No snapshots yet.</p>}
          <div className="space-y-2">
            {(data?.snapshots || []).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">Rev {s.revision} — {s.description}</p>
                  <p className="text-xs text-gray-500">{s.createdAt} · {s.lineItemCount} items</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="text-xs">{s.status}</Badge>
                  <p className="text-sm font-bold font-mono">${s.grandTotal?.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: RFIs ────────────────────────────────────────────────────────────
// GET  /api/estimates/:modelId/rfis
//   Response: { modelId, rfiCount, rfis[].id, .subject, .status, .priority,
//               .createdAt, .costImpactLow, .costImpactHigh, .itemCount }
// POST /api/estimates/:modelId/rfis
//   Body: { items: MissingDataItem[], projectName?, createdBy? }
//   MissingDataItem: { category, csiDivision, description, impact,
//     discoveredBy, floorLabel?, drawingRef?, specSection?,
//     costImpactLow, costImpactHigh }

function EngineRfisTab({ modelId, projectName }: { modelId: string; projectName: string }) {
  const queryClient = useQueryClient();
  const [rfiDesc, setRfiDesc]         = useState("");
  const [rfiDiv, setRfiDiv]           = useState("03");
  const [rfiImpact, setRfiImpact]     = useState("medium");
  const [rfiCostLow, setRfiCostLow]   = useState("0");
  const [rfiCostHigh, setRfiCostHigh] = useState("0");

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/rfis`],
    enabled: !!modelId,
  });

  const createRfi = useMutation({
    mutationFn: () => apiRequest("POST", `/api/estimates/${modelId}/rfis`, {
      items: [{
        category: "missing-dimension",
        csiDivision: rfiDiv,
        description: rfiDesc,
        impact: rfiImpact,
        discoveredBy: "EstimatorPro UI",
        costImpactLow:  parseFloat(rfiCostLow),
        costImpactHigh: parseFloat(rfiCostHigh),
      }],
      projectName,
      createdBy: "EstimatorPro UI",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${modelId}/rfis`] });
      setRfiDesc("");
    },
  });

  const priorityColor = (p: string) =>
    ({ high: "text-red-600", medium: "text-yellow-600", low: "text-green-600" }[p] || "");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Generate RFI for Missing Data</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Description of missing data</Label>
              <Input value={rfiDesc} onChange={e => setRfiDesc(e.target.value)} placeholder="e.g. Concrete slab thickness not specified on drawings" className="mt-1" />
            </div>
            <div><Label className="text-xs">CSI Division</Label><Input value={rfiDiv} onChange={e => setRfiDiv(e.target.value)} placeholder="03" className="mt-1" /></div>
            <div>
              <Label className="text-xs">Impact</Label>
              <Select value={rfiImpact} onValueChange={setRfiImpact}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Cost Impact Low ($)</Label><Input type="number" value={rfiCostLow} onChange={e => setRfiCostLow(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">Cost Impact High ($)</Label><Input type="number" value={rfiCostHigh} onChange={e => setRfiCostHigh(e.target.value)} className="mt-1" /></div>
          </div>
          <Button onClick={() => createRfi.mutate()} disabled={!modelId || !rfiDesc}>
            <AlertTriangle className="w-4 h-4 mr-2" />Generate RFI
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">RFI Register — {data?.rfiCount ?? 0} RFIs</CardTitle></CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {data?.rfiCount === 0 && <p className="text-sm text-gray-500">No RFIs generated yet.</p>}
          <div className="space-y-2">
            {(data?.rfis || []).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{r.subject}</p>
                  <p className="text-xs text-gray-500">{r.createdAt} · {r.itemCount} items</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className={`text-xs ${priorityColor(r.priority)}`}>{r.priority}</Badge>
                  <Badge variant={r.status === "open" ? "destructive" : "outline"} className="text-xs">{r.status}</Badge>
                  <p className="text-xs text-gray-500 font-mono">${r.costImpactLow?.toLocaleString()}–${r.costImpactHigh?.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: QUOTE REGISTER ──────────────────────────────────────────────────
// GET  /api/estimates/:modelId/quotes
//   Response: { modelId, register, report }
//   register: .totalQuotes, .totalQuotedValue, .quotes[]
// POST /api/estimates/:modelId/quotes
//   Required: vendorName, csiDivision (verified from estimator-router.ts)

function EngineQuotesTab({ modelId }: { modelId: string }) {
  const queryClient = useQueryClient();
  const [vendor, setVendor]         = useState("");
  const [div, setDiv]               = useState("03");
  const [desc, setDesc]             = useState("");
  const [amount, setAmount]         = useState("0");
  const [validUntil, setValidUntil] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/quotes`],
    enabled: !!modelId,
  });

  const addQuote = useMutation({
    mutationFn: () => apiRequest("POST", `/api/estimates/${modelId}/quotes`, {
      vendorName: vendor,
      csiDivision: div,
      csiSubdivision: div + "00",
      lineItemDescription: desc,
      quotedAmount: parseFloat(amount),
      quoteDate: new Date().toISOString().split("T")[0],
      validUntil: validUntil || "",
      includesLabor: true,
      includesMaterial: true,
      includesEquipment: false,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${modelId}/quotes`] });
      setVendor(""); setDesc(""); setAmount("0");
    },
  });

  const reg = data?.register;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Register Vendor Quote</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div><Label className="text-xs">Vendor Name</Label><Input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Ontario Concrete Ltd." className="mt-1" /></div>
            <div><Label className="text-xs">CSI Division</Label><Input value={div} onChange={e => setDiv(e.target.value)} placeholder="03" className="mt-1" /></div>
            <div><Label className="text-xs">Quoted Amount ($)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1" /></div>
            <div className="sm:col-span-2"><Label className="text-xs">Scope Description</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Supply and install…" className="mt-1" /></div>
            <div><Label className="text-xs">Valid Until</Label><Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="mt-1" /></div>
          </div>
          <Button onClick={() => addQuote.mutate()} disabled={!modelId || !vendor || !desc}>
            <Send className="w-4 h-4 mr-2" />Register Quote
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Quote Register — {reg?.totalQuotes ?? 0} quotes{reg?.totalQuotedValue ? ` · Total: $${reg.totalQuotedValue?.toLocaleString()}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {reg?.totalQuotes === 0 && <p className="text-sm text-gray-500">No quotes registered yet.</p>}
          <div className="space-y-2">
            {(reg?.quotes || []).map((q: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{q.vendorName}</p>
                  <p className="text-xs text-gray-500">Div {q.csiDivision} — {q.lineItemDescription}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="text-xs">{q.status}</Badge>
                  <p className="text-sm font-bold font-mono">${q.quotedAmount?.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── ENGINE: ALTERNATES ──────────────────────────────────────────────────────
// GET  /api/estimates/:modelId/alternates
//   Response: { modelId, summary, alternates[] }
//   alternates[].alternateId, .alternateNumber, .name, .description,
//   .type, .origin, .status, .alternateCost, .baseBidCost,
//   .affectedCSIDivisions
// POST /api/estimates/:modelId/alternates
//   Required: description, alternateCost (verified from estimator-router.ts)

function EngineAlternatesTab({ modelId }: { modelId: string }) {
  const queryClient = useQueryClient();
  const [altDesc, setAltDesc]   = useState("");
  const [altName, setAltName]   = useState("");
  const [altType, setAltType]   = useState("substitution");
  const [altCost, setAltCost]   = useState("0");
  const [baseCost, setBaseCost] = useState("0");
  const [altDiv, setAltDiv]     = useState("09");

  const { data, isLoading } = useQuery<any>({
    queryKey: [`/api/estimates/${modelId}/alternates`],
    enabled: !!modelId,
  });

  const addAlt = useMutation({
    mutationFn: () => apiRequest("POST", `/api/estimates/${modelId}/alternates`, {
      description: altDesc,
      name: altName || altDesc.substring(0, 40),
      type: altType,
      origin: "value-engineering",
      alternateCost: parseFloat(altCost),
      baseBidCost:   parseFloat(baseCost),
      affectedCSIDivisions: [altDiv],
      laborImpact: 0, materialImpact: 0, equipmentImpact: 0, scheduleImpactDays: 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/estimates/${modelId}/alternates`] });
      setAltDesc(""); setAltName(""); setAltCost("0"); setBaseCost("0");
    },
  });

  const summ = data?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Create Alternate / VE Item</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input value={altDesc} onChange={e => setAltDesc(e.target.value)} placeholder="e.g. Substitute LVL beams for glulam" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={altType} onValueChange={setAltType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="substitution">Substitution</SelectItem>
                  <SelectItem value="add">Add</SelectItem>
                  <SelectItem value="deduct">Deduct</SelectItem>
                  <SelectItem value="redesign">Redesign</SelectItem>
                  <SelectItem value="phasing">Phasing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Base Bid Cost ($)</Label><Input type="number" value={baseCost} onChange={e => setBaseCost(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">Alternate Cost ($)</Label><Input type="number" value={altCost} onChange={e => setAltCost(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">Affected CSI Division</Label><Input value={altDiv} onChange={e => setAltDiv(e.target.value)} placeholder="06" className="mt-1" /></div>
          </div>
          <Button onClick={() => addAlt.mutate()} disabled={!modelId || !altDesc}>
            <Send className="w-4 h-4 mr-2" />Add Alternate
          </Button>
        </CardContent>
      </Card>
      {(data || summ) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Alternates — {summ?.totalAlternates ?? data?.alternates?.length ?? 0} items
              {summ?.netVEImpact !== undefined ? ` · Net VE: $${summ.netVEImpact?.toLocaleString()}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {!data?.alternates?.length && <p className="text-sm text-gray-500">No alternates created yet.</p>}
            <div className="space-y-2">
              {(data?.alternates || []).map((a: any) => (
                <div key={a.alternateId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">ALT-{String(a.alternateNumber).padStart(3, "0")} — {a.name}</p>
                    <p className="text-xs text-gray-500">{a.type} · Divs {a.affectedCSIDivisions?.join(", ")}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="text-xs">{a.status}</Badge>
                    <p className={`text-sm font-bold font-mono ${a.alternateCost < a.baseBidCost ? "text-green-600" : "text-red-600"}`}>
                      {a.alternateCost < a.baseBidCost ? "–" : "+"}${Math.abs(a.alternateCost - a.baseBidCost)?.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── ENGINE: BID LEVELING ────────────────────────────────────────────────────
// POST /api/estimates/:modelId/bid-leveling
// Body: { bids: BidPackage[], config?: BidLevelConfig }
// BidPackage: bidderName, bidderCompany, totalBidAmount, submissionDate,
//   bondIncluded, insuranceCertificate, addendaAcknowledged[], qualifications[],
//   lineItems[]
// Response: { modelId, bidLeveling: BidLevelingReport, report }
// BidLevelingReport: .engineerEstimate, .bidCount,
//   .bidderSummaries[].bidderName, .totalBidAmount, .normalisedAmount,
//   .varianceFromEngineer, .variancePercent, .ranking,
//   .divisionMatrix[].csiDivision, .divisionName, .engineerEstimate,
//   .bidders[].bidderName, .amount, .variancePercent, .flagged,
//   .scopeGaps[].csiDivision, .description, .bidderName, .gapType,
//   .recommendations[]

function EngineBidLevelTab({ modelId }: { modelId: string }) {
  const [bids, setBids] = useState<{ name: string; company: string; total: string }[]>([
    { name: "", company: "", total: "0" },
  ]);
  const [result, setResult]     = useState<any>(null);
  const [running, setRunning]   = useState(false);
  const [runError, setRunError] = useState("");

  const addBidder = () => setBids(prev => [...prev, { name: "", company: "", total: "0" }]);
  const updateBid = (i: number, field: string, val: string) =>
    setBids(prev => prev.map((b, idx) => idx === i ? { ...b, [field]: val } : b));

  const runBidLevel = async () => {
    setRunning(true); setRunError("");
    try {
      const bidPackages = bids
        .filter(b => b.name && parseFloat(b.total) > 0)
        .map(b => ({
          bidderName: b.name, bidderCompany: b.company || b.name,
          totalBidAmount: parseFloat(b.total),
          submissionDate: new Date().toISOString().split("T")[0],
          bondIncluded: true, insuranceCertificate: true,
          addendaAcknowledged: [], qualifications: [], lineItems: [],
        }));
      if (!bidPackages.length) {
        setRunError("Add at least one bidder with a name and amount.");
        return;
      }
      const res = await apiRequest("POST", `/api/estimates/${modelId}/bid-leveling`, {
        bids: bidPackages,
        config: { varianceThreshold: 15, significantGapThreshold: 10000, normaliseBids: true },
      });
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setRunError(e?.message || "Bid leveling failed.");
    } finally {
      setRunning(false);
    }
  };

  const report = result?.bidLeveling;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Bid Leveling / Tender Reconciliation (CCDC 23)</CardTitle>
            <Button size="sm" variant="outline" onClick={addBidder}>+ Add Bidder</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 mb-4">
            {bids.map((b, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Bidder Name</Label><Input value={b.name} onChange={e => updateBid(i, "name", e.target.value)} placeholder="e.g. Smith Construction" className="mt-1" /></div>
                <div><Label className="text-xs">Company</Label><Input value={b.company} onChange={e => updateBid(i, "company", e.target.value)} placeholder="Company name" className="mt-1" /></div>
                <div><Label className="text-xs">Bid Amount ($)</Label><Input type="number" value={b.total} onChange={e => updateBid(i, "total", e.target.value)} className="mt-1" /></div>
              </div>
            ))}
          </div>
          {runError && <p className="text-sm text-red-500 mb-2">{runError}</p>}
          <Button onClick={runBidLevel} disabled={!modelId || running}>
            <Scale className="w-4 h-4 mr-2" />{running ? "Leveling…" : "Run Bid Leveling"}
          </Button>
        </CardContent>
      </Card>

      {report && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Bidder Rankings — Engineer's Estimate: ${report.engineerEstimate?.toLocaleString()}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Rank</th><th className="pb-2 pr-3">Bidder</th>
                    <th className="pb-2 pr-3 text-right">Bid Total</th><th className="pb-2 pr-3 text-right">Normalised</th>
                    <th className="pb-2 pr-3 text-right">vs Engineer</th><th className="pb-2 text-right">Variance %</th>
                  </tr></thead>
                  <tbody>
                    {(report.bidderSummaries || []).map((b: any) => (
                      <tr key={b.bidderName} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-bold">#{b.ranking}</td>
                        <td className="py-2 pr-3">{b.bidderName}</td>
                        <td className="py-2 pr-3 text-right font-mono">${b.totalBidAmount?.toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right font-mono">${b.normalisedAmount?.toLocaleString()}</td>
                        <td className={`py-2 pr-3 text-right font-mono ${b.varianceFromEngineer > 0 ? "text-red-600" : "text-green-600"}`}>
                          {b.varianceFromEngineer > 0 ? "+" : ""}${b.varianceFromEngineer?.toLocaleString()}
                        </td>
                        <td className={`py-2 text-right font-mono ${Math.abs(b.variancePercent) > 15 ? "text-red-600 font-bold" : ""}`}>
                          {b.variancePercent?.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {report.divisionMatrix?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Division × Bidder Matrix</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="pb-2 pr-2">Div</th><th className="pb-2 pr-2">Description</th>
                        <th className="pb-2 pr-2 text-right">Engineer</th>
                        {(report.bidderSummaries || []).map((b: any) => (
                          <th key={b.bidderName} className="pb-2 pr-2 text-right">{b.bidderName}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.divisionMatrix.map((row: any) => (
                        <tr key={row.csiDivision} className="border-b border-gray-100">
                          <td className="py-1.5 pr-2 font-mono font-bold">{row.csiDivision}</td>
                          <td className="py-1.5 pr-2">{row.divisionName}</td>
                          <td className="py-1.5 pr-2 text-right font-mono">${row.engineerEstimate?.toLocaleString()}</td>
                          {(row.bidders || []).map((b: any) => (
                            <td key={b.bidderName} className={`py-1.5 pr-2 text-right font-mono ${b.flagged ? "text-red-600 font-bold" : ""}`}>
                              ${b.amount?.toLocaleString()}{b.flagged && <span className="ml-1">⚠</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {report.recommendations?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">QS Recommendations ({report.recommendations.length})</CardTitle></CardHeader>
              <CardContent>
                {report.recommendations.map((r: string, i: number) => (
                  <div key={i} className="flex items-start space-x-2 text-sm mb-2">
                    <ChevronRight className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" /><span>{r}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {report.scopeGaps?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Scope Gaps ({report.scopeGaps.length})</CardTitle></CardHeader>
              <CardContent>
                {report.scopeGaps.map((g: any, i: number) => (
                  <div key={i} className="flex items-start space-x-2 text-sm mb-2 p-2 bg-yellow-50 rounded">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Div {g.csiDivision} — {g.bidderName}: {g.gapType}</p>
                      <p className="text-xs text-gray-600">{g.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ENGINE: STATUS ──────────────────────────────────────────────────────────
// GET /api/estimator/status
// Response: { engine, version, modulesWired, modules[], benchmarkPacks[],
//             inMemoryStores: { snapshots, rfis, quotes, alternates }, status }

function EngineStatusTab() {
  const { data, isLoading, refetch } = useQuery<any>({ queryKey: [`/api/estimator/status`] });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Estimate Engine Health</CardTitle>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3 mr-1" />Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-gray-500">Checking engine status…</p>}
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`p-3 rounded-lg ${data.status === "operational" ? "bg-green-50" : "bg-red-50"}`}>
                  <p className="text-xs text-gray-500">Status</p>
                  <p className={`font-bold ${data.status === "operational" ? "text-green-700" : "text-red-700"}`}>
                    {data.status === "operational" ? "✓ Operational" : "✗ " + data.status}
                  </p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Engine</p><p className="font-bold">{data.engine} v{data.version}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Modules Wired</p><p className="text-lg font-bold">{data.modulesWired}</p></div>
                <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500">Benchmark Packs</p><p className="text-lg font-bold">{data.benchmarkPacks?.length}</p></div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">In-Memory Store Sizes (current session)</p>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(data.inMemoryStores || {}).map(([k, v]) => (
                    <div key={k} className="bg-gray-50 p-2 rounded text-center">
                      <p className="text-xs text-gray-500 capitalize">{k}</p>
                      <p className="font-bold">{v as number}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Modules ({data.modules?.length})</p>
                <div className="flex flex-wrap gap-1">
                  {(data.modules || []).map((m: string) => (
                    <div key={m} className="flex items-center space-x-1 bg-green-50 px-2 py-1 rounded">
                      <Activity className="w-3 h-3 text-green-600" />
                      <span className="text-xs font-mono text-green-700">{m}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Registered Benchmark Packs</p>
                <div className="flex flex-wrap gap-2">
                  {(data.benchmarkPacks || []).map((p: string) => (
                    <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Phase 2 stub tabs — wired in routing, not yet implemented ──────────────
function EngineSovEngineTab({ modelId }: { modelId: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <p className="font-medium">Schedule of Values Engine</p>
      <p className="text-sm mt-1">Phase 2 — Model: {modelId}</p>
    </div>
  );
}

function EngineBenchmarkEngineTab({ modelId }: { modelId: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <p className="font-medium">Benchmark Engine</p>
      <p className="text-sm mt-1">Phase 2 — Model: {modelId}</p>
    </div>
  );
}

function EngineMonteCarloTab({ modelId }: { modelId: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <p className="font-medium">Monte Carlo Simulation</p>
      <p className="text-sm mt-1">Phase 2 — Model: {modelId}</p>
    </div>
  );
}

function EngineCostEstimateTab({ projectId }: { projectId: string }) {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <p className="font-medium">Cost Estimate Engine</p>
      <p className="text-sm mt-1">Phase 2 — Project: {projectId}</p>
    </div>
  );
}

function EngineBoeTab({ modelId }: { modelId: string }) {
  return <EngineBidLevelTab modelId={modelId} />;  // BOE reuses Bid Level engine view
}

function EngineBoqCostsTab({ projectId }: { projectId: string }) {
  return <EngineCostEstimateTab projectId={projectId} />;  // BOQ Costs reuses Cost Estimate view
}

function EngineCostUpdateTab({ projectId }: { projectId: string }) {
  return (
    <div className="p-6 text-muted-foreground text-sm">
      Cost Update module — Phase 2 (pending live cost feed integration)
    </div>
  );
}

