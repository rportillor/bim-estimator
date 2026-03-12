// client/src/pages/sequence-review.tsx
// =============================================================================
// CONSTRUCTION SEQUENCE REVIEW — QS Confirmation UI
// =============================================================================
//
// Workflow:
//   1. QS clicks "Generate Sequence" → POST /sequence/propose
//   2. AI returns proposed activities with rationale, risks, durations
//   3. QS reviews each activity:
//      - Edit duration, predecessors, floor scope, QS comment
//      - Drag to reorder (visual only — predecessors remain authoritative for CPM)
//      - Add or remove activities
//   4. QS clicks "Confirm Sequence" → PUT /sequence/:id/confirm
//   5. Export buttons: XER (Primavera P6) or MS Project XML
// =============================================================================

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle, CheckCircle, Clock, Download, FileText,
  Play, RefreshCw, ChevronDown, ChevronRight, Edit2, Save,
  X, Info, Zap, Flag, Package, CalendarDays, Users,
} from "lucide-react";

// ─── Types (mirrors server types) ─────────────────────────────────────────────

interface SequenceActivity {
  activityId:    string;
  wbsCode:       string;
  wbsName:       string;
  name:          string;
  description:   string;
  csiDivisions:  string[];
  floors:        string[];
  zone:          string;
  durationDays:  number;
  lagDays:       number;
  predecessors:  string[];
  dependencyType: "FS" | "SS" | "FF" | "SF";
  crewType:      string;
  crewSize:      number;
  estimatedCost: number;
  costMaterial:  number;
  costLabour:    number;
  costEquipment: number;
  isCriticalPath: boolean;
  isLongLead:    boolean;
  longLeadItem:  string | null;
  isMilestone:   boolean;
  rationale:     string;
  assumptions:   string[];
  risks:         string[];
  qsEdited:      boolean;
  qsComment:     string;
}

interface SequenceProposal {
  sequenceId:         string;
  status:             string;
  proposal: {
    activities:          SequenceActivity[];
    totalDurationDays:   number;
    estimatedStartDate:  string | null;
    estimatedEndDate:    string | null;
    rationale:           string;
    constructionMethod:  string;
    keyAssumptions:      string[];
    warnings:            string[];
    criticalPath:        string[];
    longLeadItems:       Array<{ activityId: string; item: string; leadWeeks: number; orderByDate: string | null }>;
    projectName:         string;
  };
  message: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

function wbsColour(code: string): string {
  const top = code.split(".")[1] || "0";
  const map: Record<string, string> = {
    "1": "bg-slate-100 text-slate-700",
    "2": "bg-orange-100 text-orange-700",
    "3": "bg-amber-100 text-amber-700",
    "4": "bg-yellow-100 text-yellow-700",
    "5": "bg-lime-100 text-lime-700",
    "6": "bg-green-100 text-green-700",
    "7": "bg-teal-100 text-teal-700",
    "8": "bg-blue-100 text-blue-700",
    "9": "bg-indigo-100 text-indigo-700",
    "10": "bg-purple-100 text-purple-700",
    "11": "bg-pink-100 text-pink-700",
  };
  return map[top] || "bg-gray-100 text-gray-700";
}

// ─── Activity Row Component ───────────────────────────────────────────────────

function ActivityRow({
  act,
  index,
  onEdit,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  act:        SequenceActivity;
  index:      number;
  onEdit:     (id: string, patch: Partial<SequenceActivity>) => void;
  onMoveUp:   (i: number) => void;
  onMoveDown: (i: number) => void;
  isFirst:    boolean;
  isLast:     boolean;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [editing,  setEditing]        = useState(false);
  const [localDur, setLocalDur]       = useState(String(act.durationDays));
  const [localPred, setLocalPred]     = useState(act.predecessors.join(", "));
  const [localComment, setLocalComment] = useState(act.qsComment);

  const saveEdit = () => {
    onEdit(act.activityId, {
      durationDays: parseInt(localDur) || act.durationDays,
      predecessors: localPred.split(",").map(s => s.trim()).filter(Boolean),
      qsComment:    localComment,
    });
    setEditing(false);
  };

  return (
    <div className={`border rounded-lg mb-2 ${act.qsEdited ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"} ${act.isCriticalPath ? "border-l-4 border-l-red-400" : ""}`}>
      {/* ── Header row ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Sequence controls */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button onClick={() => onMoveUp(index)}   disabled={isFirst} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-none">▲</button>
          <button onClick={() => onMoveDown(index)} disabled={isLast}  className="text-gray-400 hover:text-gray-700 disabled:opacity-20 text-xs leading-none">▼</button>
        </div>

        {/* Activity ID */}
        <span className="font-mono text-xs text-gray-500 w-12 flex-shrink-0">{act.activityId}</span>

        {/* WBS badge */}
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${wbsColour(act.wbsCode)}`}>
          {act.wbsCode}
        </span>

        {/* Name */}
        <span className="font-medium text-sm flex-1 min-w-0 truncate">
          {act.isMilestone && <Flag className="inline w-3 h-3 text-purple-500 mr-1" />}
          {act.name}
        </span>

        {/* Flags */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {act.isCriticalPath && <span className="text-xs bg-red-100 text-red-700 px-1.5 rounded font-medium">CP</span>}
          {act.isLongLead    && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 rounded font-medium flex items-center gap-0.5"><Package className="w-3 h-3" />LL</span>}
          {act.qsEdited      && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 rounded font-medium">QS</span>}
          {act.risks.length > 0 && <AlertTriangle className="w-3 h-3 text-amber-500" />}
        </div>

        {/* Duration */}
        <span className="text-xs text-gray-500 w-20 text-right flex-shrink-0">
          {act.durationDays}d
        </span>

        {/* Cost */}
        <span className="text-xs text-gray-600 w-28 text-right flex-shrink-0 font-medium">
          {fmt(act.estimatedCost)}
        </span>

        {/* Expand / edit */}
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={() => setEditing(!editing)} className="text-gray-400 hover:text-blue-500 p-1">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-700 p-1">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Inline editor ── */}
      {editing && (
        <div className="px-4 pb-3 pt-1 border-t border-gray-100 bg-blue-50">
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Duration (working days)</label>
              <Input value={localDur} onChange={e => setLocalDur(e.target.value)} className="h-7 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Predecessors (e.g. A1010, A1020)</label>
              <Input value={localPred} onChange={e => setLocalPred(e.target.value)} className="h-7 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">QS Comment</label>
              <Input value={localComment} onChange={e => setLocalComment(e.target.value)} className="h-7 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit} className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
              <Save className="w-3 h-3 mr-1" />Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">
              <X className="w-3 h-3 mr-1" />Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-gray-100 space-y-2">
          <p className="text-xs text-gray-600">{act.description}</p>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="font-medium text-gray-500">Crew:</span> {act.crewType} ({act.crewSize} workers)
            </div>
            <div>
              <span className="font-medium text-gray-500">Zone:</span> {act.zone}
            </div>
            <div>
              <span className="font-medium text-gray-500">Floors:</span> {act.floors.length ? act.floors.join(", ") : "All / N/A"}
            </div>
            <div>
              <span className="font-medium text-gray-500">CSI:</span> {act.csiDivisions.join(", ")}
            </div>
            <div>
              <span className="font-medium text-gray-500">Predecessors:</span>{" "}
              {act.predecessors.length ? act.predecessors.join(", ") + ` (${act.dependencyType})` : "None"}
            </div>
            <div>
              <span className="font-medium text-gray-500">Lag:</span> {act.lagDays}d
            </div>
          </div>

          {/* Cost breakdown */}
          <div className="flex gap-4 text-xs bg-gray-50 rounded p-2">
            <span><span className="text-gray-500">Mat:</span> {fmt(act.costMaterial)}</span>
            <span><span className="text-gray-500">Lab:</span> {fmt(act.costLabour)}</span>
            <span><span className="text-gray-500">Equip:</span> {fmt(act.costEquipment)}</span>
          </div>

          {/* AI Rationale */}
          <div className="bg-indigo-50 rounded p-2 text-xs text-indigo-800">
            <span className="font-semibold">AI Rationale:</span> {act.rationale}
          </div>

          {/* Assumptions */}
          {act.assumptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                <Info className="w-3 h-3" />QS must verify:
              </p>
              <ul className="text-xs text-gray-600 space-y-0.5">
                {act.assumptions.map((a, i) => <li key={i} className="flex gap-1"><span className="text-gray-400">•</span>{a}</li>)}
              </ul>
            </div>
          )}

          {/* Risks */}
          {act.risks.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />Risks:
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5">
                {act.risks.map((r, i) => <li key={i} className="flex gap-1"><span>⚠</span>{r}</li>)}
              </ul>
            </div>
          )}

          {/* Long lead */}
          {act.isLongLead && act.longLeadItem && (
            <div className="bg-amber-50 rounded p-2 text-xs text-amber-800 flex items-center gap-1">
              <Package className="w-3 h-3" />
              <strong>Long Lead:</strong> {act.longLeadItem}
            </div>
          )}

          {/* QS comment */}
          {act.qsComment && (
            <div className="bg-blue-50 rounded p-2 text-xs text-blue-800">
              <strong>QS Note:</strong> {act.qsComment}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SequenceReview() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Extract projectId from URL /projects/:id/sequence
  const projectId = location.split("/projects/")[1]?.split("/")[0] || "";

  const [modelId,       setModelId]       = useState("");
  const [startDate,     setStartDate]     = useState("");
  const [activities,    setActivities]    = useState<SequenceActivity[]>([]);
  const [sequenceId,    setSequenceId]    = useState<string | null>(null);
  const [sequenceStatus, setSequenceStatus] = useState<string>("");
  const [proposal,      setProposal]      = useState<SequenceProposal["proposal"] | null>(null);
  const [qsNotes,       setQsNotes]       = useState("");
  const [confirmed,     setConfirmed]     = useState(false);

  // ── Load existing sequence if one exists ─────────────────────────────────
  useQuery({
    queryKey: [`/api/projects/${projectId}/sequence`],
    enabled:  !!projectId,
    retry:    false,
    queryFn:  async () => {
      const res = await fetch(`/api/projects/${projectId}/sequence`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const p: SequenceProposal["proposal"] = (data.confirmedData || data.proposedData) as any;
      setProposal(p);
      setActivities(p?.activities || []);
      setSequenceId(data.id);
      setSequenceStatus(data.status);
      setConfirmed(data.status === "confirmed" || data.status === "exported");
      return data;
    },
  });

  // ── Load BIM models for selector ─────────────────────────────────────────
  const { data: models = [] } = useQuery<any[]>({
    queryKey: [`/api/bim/models?projectId=${projectId}`],
    enabled:  !!projectId,
  });

  // ── Propose mutation ──────────────────────────────────────────────────────
  const proposeMut = useMutation({
    mutationFn: async (): Promise<SequenceProposal> => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/sequence/propose`, {
        modelId,
        projectStartDate: startDate || null,
      });
      return res.json() as Promise<SequenceProposal>;
    },
    onSuccess: (data: SequenceProposal) => {
      setProposal(data.proposal);
      setActivities(data.proposal.activities);
      setSequenceId(data.sequenceId);
      setSequenceStatus("proposed");
      setConfirmed(false);
    },
    onError: (error: Error) => {
      toast({ title: "Sequence proposal failed", description: error.message, variant: "destructive" });
    },
  });

  // ── Confirm mutation ──────────────────────────────────────────────────────
  const confirmMut = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/projects/${projectId}/sequence/${sequenceId}/confirm`, {
        activities,
        qsNotes,
        projectStartDate: startDate || null,
      }),
    onSuccess: () => {
      setSequenceStatus("confirmed");
      setConfirmed(true);
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/sequence`] });
    },
    onError: (error: Error) => {
      toast({ title: "Sequence confirmation failed", description: error.message, variant: "destructive" });
    },
  });

  // ── Activity edit ─────────────────────────────────────────────────────────
  const handleEdit = useCallback((actId: string, patch: Partial<SequenceActivity>) => {
    setActivities(prev =>
      prev.map(a => a.activityId === actId ? { ...a, ...patch, qsEdited: true } : a)
    );
    setConfirmed(false); // must re-confirm after any edit
  }, []);

  const handleMoveUp = useCallback((i: number) => {
    if (i === 0) return;
    setActivities(prev => { const arr = [...prev]; [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; return arr; });
    setConfirmed(false);
  }, []);

  const handleMoveDown = useCallback((i: number) => {
    setActivities(prev => {
      if (i >= prev.length - 1) return prev;
      const arr = [...prev]; [arr[i], arr[i+1]] = [arr[i+1], arr[i]]; return arr;
    });
    setConfirmed(false);
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportFile = async (format: "xer" | "ms-project") => {
    const url = `/api/projects/${projectId}/sequence/${sequenceId}/export/${format}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
    });
    if (!res.ok) { alert("Export failed: " + (await res.text())); return; }
    const blob = await res.blob();
    const ext  = format === "xer" ? ".xer" : ".xml";
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `Schedule${ext}`;
    a.click();
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  const cpCount    = activities.filter(a => a.isCriticalPath).length;
  const llCount    = activities.filter(a => a.isLongLead).length;
  const totalCost  = activities.reduce((s, a) => s + a.estimatedCost, 0);
  const editedCount = activities.filter(a => a.qsEdited).length;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <CalendarDays className="w-6 h-6 text-indigo-600" />
              Construction Sequence
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              AI-proposed schedule — review, edit, confirm, then export to Primavera P6 or MS Project
            </p>
          </div>

          {/* Status badge */}
          {sequenceStatus && (
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              sequenceStatus === "confirmed" || sequenceStatus === "exported"
                ? "bg-green-100 text-green-700"
                : sequenceStatus === "proposed"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-600"
            }`}>
              {sequenceStatus === "confirmed" ? "✓ QS Confirmed" :
               sequenceStatus === "exported"  ? "✓ Exported"    :
               sequenceStatus === "proposed"  ? "⏳ Awaiting QS Review" : sequenceStatus}
            </span>
          )}
        </div>

        {/* ── Generate panel ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-500" />
            Generate AI Sequence Proposal
          </h2>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">BIM Model</label>
              <select
                value={modelId}
                onChange={e => setModelId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">— select model —</option>
                {(models as any[]).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            </div>
            <div className="w-48">
              <label className="text-xs text-gray-500 block mb-1">Project Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <Button
              onClick={() => proposeMut.mutate()}
              disabled={!modelId || proposeMut.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 h-9"
            >
              {proposeMut.isPending
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                : <><Play className="w-4 h-4 mr-2" />Generate Proposal</>}
            </Button>
          </div>
          {proposeMut.isPending && (
            <p className="text-xs text-indigo-600 mt-2 animate-pulse">
              Claude is analysing the BIM model and building a P6-ready construction sequence…
            </p>
          )}
        </div>

        {/* ── Proposal exists ── */}
        {proposal && (
          <>
            {/* ── Summary cards ── */}
            <div className="grid grid-cols-5 gap-3 mb-5">
              <div className="bg-white rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{activities.length}</p>
                <p className="text-xs text-gray-500">Activities</p>
              </div>
              <div className="bg-white rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{proposal.totalDurationDays}d</p>
                <p className="text-xs text-gray-500">Working Days</p>
              </div>
              <div className="bg-red-50 rounded-lg border border-red-200 p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{cpCount}</p>
                <p className="text-xs text-red-500">Critical Path</p>
              </div>
              <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{llCount}</p>
                <p className="text-xs text-amber-500">Long Lead</p>
              </div>
              <div className="bg-white rounded-lg border p-3 text-center">
                <p className="text-lg font-bold text-gray-900">{fmt(totalCost)}</p>
                <p className="text-xs text-gray-500">Scheduled Value</p>
              </div>
            </div>

            {/* Dates */}
            {(proposal.estimatedStartDate || proposal.estimatedEndDate) && (
              <div className="flex gap-4 mb-4 text-sm text-gray-600">
                {proposal.estimatedStartDate && <span><span className="font-medium">Start:</span> {proposal.estimatedStartDate}</span>}
                {proposal.estimatedEndDate   && <span><span className="font-medium">Forecast Complete:</span> {proposal.estimatedEndDate}</span>}
              </div>
            )}

            {/* AI rationale */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-5">
              <p className="text-sm font-semibold text-indigo-800 mb-1">AI Sequencing Rationale</p>
              <p className="text-sm text-indigo-700">{proposal.rationale}</p>
              <p className="text-xs text-indigo-600 mt-1"><span className="font-medium">Method:</span> {proposal.constructionMethod}</p>
            </div>

            {/* Warnings */}
            {proposal.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
                <p className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" />QS Must Resolve Before Confirming
                </p>
                <ul className="space-y-1">
                  {proposal.warnings.map((w, i) => (
                    <li key={i} className="text-sm text-amber-700 flex gap-2">
                      <span className="text-amber-500 flex-shrink-0">⚠</span>{w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Long lead register */}
            {proposal.longLeadItems.length > 0 && (
              <div className="bg-white rounded-lg border p-4 mb-5">
                <p className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-1">
                  <Package className="w-4 h-4 text-amber-500" />Long Lead Procurement Register
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b">
                        <th className="text-left pb-1">Activity</th>
                        <th className="text-left pb-1">Item</th>
                        <th className="text-right pb-1">Lead (wks)</th>
                        <th className="text-right pb-1">Order By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.longLeadItems.map((ll, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-1 font-mono text-gray-500">{ll.activityId}</td>
                          <td className="py-1">{ll.item}</td>
                          <td className="py-1 text-right text-amber-600 font-medium">{ll.leadWeeks}</td>
                          <td className="py-1 text-right text-gray-500">{ll.orderByDate || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* QS edits summary */}
            {editedCount > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm text-blue-700">
                <span className="font-medium">{editedCount} activit{editedCount === 1 ? "y" : "ies"} edited by QS.</span>
                {" "}You must confirm the sequence again before exporting.
              </div>
            )}

            {/* ── Activity list ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">
                  Activity Sequence
                  <span className="text-xs font-normal text-gray-400 ml-2">
                    Edit durations, predecessors, or drag to reorder
                  </span>
                </h2>
                <div className="flex gap-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" />Critical path</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />QS edited</span>
                </div>
              </div>

              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 py-1 text-xs text-gray-400 mb-1">
                <span className="w-5" />
                <span className="w-12">ID</span>
                <span className="w-12">WBS</span>
                <span className="flex-1">Activity Name</span>
                <span className="w-20 text-right">Duration</span>
                <span className="w-28 text-right">Sched. Value</span>
                <span className="w-10" />
              </div>

              {activities.map((act, i) => (
                <ActivityRow
                  key={act.activityId}
                  act={act}
                  index={i}
                  onEdit={handleEdit}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  isFirst={i === 0}
                  isLast={i === activities.length - 1}
                />
              ))}
            </div>

            {/* ── QS Confirmation panel ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
              <h2 className="font-semibold text-gray-800 mb-3">QS Confirmation</h2>
              <div className="mb-3">
                <label className="text-xs text-gray-500 block mb-1">QS Notes (optional)</label>
                <textarea
                  value={qsNotes}
                  onChange={e => setQsNotes(e.target.value)}
                  rows={3}
                  placeholder="Record any QS assumptions, scope clarifications, or schedule constraints..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => confirmMut.mutate()}
                  disabled={confirmed || confirmMut.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {confirmMut.isPending
                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Confirming…</>
                    : confirmed
                    ? <><CheckCircle className="w-4 h-4 mr-2" />Sequence Confirmed</>
                    : <><CheckCircle className="w-4 h-4 mr-2" />Confirm Sequence</>}
                </Button>

                {confirmMut.isSuccess && (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />Confirmed — ready to export to P6
                  </span>
                )}
              </div>
            </div>

            {/* ── Export panel ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-gray-800 mb-1 flex items-center gap-2">
                <Download className="w-4 h-4 text-gray-500" />Export to Scheduler
              </h2>
              <p className="text-xs text-gray-400 mb-4">
                XER export requires QS confirmation. MS Project XML can be downloaded any time.
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => exportFile("xer")}
                  disabled={!confirmed}
                  className="bg-blue-700 hover:bg-blue-800 text-white"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Primavera P6 (.xer)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportFile("ms-project")}
                  disabled={!sequenceId}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  MS Project (.xml)
                </Button>
              </div>
              {!confirmed && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠ Confirm the sequence above before exporting to Primavera P6.
                  This ensures P6 receives a QS-reviewed, not AI-raw, schedule.
                </p>
              )}
            </div>
          </>
        )}

        {/* Empty state */}
        {!proposal && !proposeMut.isPending && (
          <div className="text-center py-16 text-gray-400">
            <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Select a BIM model and click Generate to get an AI construction sequence proposal.</p>
          </div>
        )}
      </div>
    </div>
  );
}
