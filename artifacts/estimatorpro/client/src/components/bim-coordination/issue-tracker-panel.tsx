// client/src/components/bim-coordination/issue-tracker-panel.tsx
// =============================================================================
// ISSUE TRACKER PANEL — SOP Part 8 Frontend
// =============================================================================
//
// Issue management interface:
//   - List issues with filter/sort (GET /api/bim-coordination/issues)
//   - Create manual issues (POST /api/bim-coordination/issues)
//   - Status transitions with 9-state workflow (PUT /issues/:id/status)
//   - Field updates (PUT /issues/:id)
//   - RFI generation (POST /issues/:id/rfi)
//   - Priority display with 4-axis scores
//
// Pattern: @tanstack/react-query + shadcn/ui + lucide-react
// =============================================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  ArrowRight,
  Clock,
  Send,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface IssueRecord {
  id: string;
  issueNumber: string;
  name: string;
  testId: string;
  type: string;
  zone: string;
  gridRef: string;
  priority: string;
  owner: string;
  assignedTo: string;
  originDiscipline: string;
  status: string;
  createdDate: string;
  targetDate: string;
  resolvedDate: string | null;
  description: string;
  recommendation: string;
  resolution: string;
  clashGroupId: string | null;
  rfiNumber: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS & PRIORITY CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-blue-100 text-blue-800 border-blue-300",
  IN_REVIEW: "bg-purple-100 text-purple-800 border-purple-300",
  DECISION_REQUIRED: "bg-orange-100 text-orange-800 border-orange-300",
  IN_PROGRESS: "bg-cyan-100 text-cyan-800 border-cyan-300",
  READY_FOR_VERIFY: "bg-indigo-100 text-indigo-800 border-indigo-300",
  RESOLVED: "bg-green-100 text-green-800 border-green-300",
  DEFERRED: "bg-gray-100 text-gray-600 border-gray-300",
  WONT_FIX: "bg-gray-200 text-gray-600 border-gray-400",
  DUPLICATE: "bg-gray-100 text-gray-500 border-gray-300",
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_REVIEW", "DUPLICATE"],
  IN_REVIEW: ["DECISION_REQUIRED", "IN_PROGRESS", "WONT_FIX"],
  DECISION_REQUIRED: ["IN_PROGRESS", "DEFERRED", "WONT_FIX"],
  IN_PROGRESS: ["READY_FOR_VERIFY", "DEFERRED"],
  READY_FOR_VERIFY: ["RESOLVED", "IN_PROGRESS"],
  RESOLVED: [],
  DEFERRED: ["OPEN"],
  WONT_FIX: [],
  DUPLICATE: [],
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: "bg-red-600 text-white",
  P2: "bg-orange-500 text-white",
  P3: "bg-yellow-500 text-black",
  P4: "bg-blue-500 text-white",
  P5: "bg-gray-400 text-white",
};

const ALL_STATUSES = Object.keys(STATUS_COLORS);

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${STATUS_COLORS[status] || STATUS_COLORS.OPEN}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.P3}`}>
      {priority}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS TRANSITION DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function StatusTransitionDialog({ issue, onTransition }: {
  issue: IssueRecord;
  onTransition: (_issueId: string, _newStatus: string, _comment: string) => void;
}) {
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const availableTransitions = STATUS_TRANSITIONS[issue.status] || [];

  if (availableTransitions.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
          <ArrowRight className="w-3 h-3" /> Transition
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Transition: {issue.issueNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs">Current Status</Label>
            <div className="mt-1"><StatusBadge status={issue.status} /></div>
          </div>
          <div>
            <Label className="text-xs">New Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select new status..." /></SelectTrigger>
              <SelectContent>
                {availableTransitions.map(s => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Comment</Label>
            <Input
              className="h-8 text-xs mt-1"
              placeholder="Reason for transition..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>
          <Button
            className="w-full h-8 text-xs"
            disabled={!selectedStatus}
            onClick={() => {
              onTransition(issue.id, selectedStatus, comment);
              setOpen(false);
              setSelectedStatus("");
              setComment("");
            }}
          >
            Confirm Transition
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE ISSUE DIALOG
// ═══════════════════════════════════════════════════════════════════════════════

function CreateIssueDialog({ onCreate }: {
  onCreate: (_data: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", zone: "", gridRef: "", description: "",
    originDiscipline: "structural", owner: "", recommendation: "",
  });

  function handleCreate() {
    onCreate(form);
    setOpen(false);
    setForm({ name: "", zone: "", gridRef: "", description: "", originDiscipline: "structural", owner: "", recommendation: "" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 h-8 text-xs">
          <Plus className="w-3 h-3" /> Create Issue
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-sm">Create Manual Issue</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="col-span-2">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 text-xs mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Issue name..." />
          </div>
          <div>
            <Label className="text-xs">Zone</Label>
            <Input className="h-8 text-xs mt-1" value={form.zone} onChange={e => setForm({ ...form, zone: e.target.value })} placeholder="e.g. NORTH" />
          </div>
          <div>
            <Label className="text-xs">Grid Ref</Label>
            <Input className="h-8 text-xs mt-1" value={form.gridRef} onChange={e => setForm({ ...form, gridRef: e.target.value })} placeholder="e.g. C3-D4" />
          </div>
          <div>
            <Label className="text-xs">Discipline</Label>
            <Select value={form.originDiscipline} onValueChange={v => setForm({ ...form, originDiscipline: v })}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["structural", "architectural", "mechanical", "electrical", "plumbing", "fire_protection"].map(d => (
                  <SelectItem key={d} value={d}>{d.replace("_", " ").toUpperCase()}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Owner</Label>
            <Input className="h-8 text-xs mt-1" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} placeholder="Assigned to..." />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Description</Label>
            <Input className="h-8 text-xs mt-1" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue..." />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Recommendation</Label>
            <Input className="h-8 text-xs mt-1" value={form.recommendation} onChange={e => setForm({ ...form, recommendation: e.target.value })} placeholder="Recommended action..." />
          </div>
        </div>
        <Button className="w-full h-8 text-xs mt-2" disabled={!form.name} onClick={handleCreate}>
          Create Issue
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function IssueTrackerPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterOwner, setFilterOwner] = useState<string>("");
  const [sortField, setSortField] = useState<string>("priority");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ── Fetch issues ─────────────────────────────────────────────────────
  const issuesQuery = useQuery<{ total: number; issues: IssueRecord[] }>({
    queryKey: ["bim-issues"],
    queryFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = {};
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/issues", { headers: ah, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load issues");
      return res.json();
    },
    refetchInterval: 15000,
  });

  // ── Auth helper ────────────────────────────────────────────────────────
  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const tk = localStorage.getItem("auth_token");
    const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
    if (tk) h["Authorization"] = `Bearer ${tk}`;
    return h;
  }

  // ── Mutations ────────────────────────────────────────────────────────
  const transitionMutation = useMutation({
    mutationFn: async ({ issueId, newStatus, comment }: { issueId: string; newStatus: string; comment: string }) => {
      const res = await fetch(`/api/bim-coordination/issues/${issueId}/status`, {
        method: "PUT",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ newStatus, user: "BIM Coordinator", comment }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bim-issues"] }),
    onError: (error: Error) => {
      toast({ title: "Status transition failed", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/bim-coordination/issues", {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bim-issues"] }),
    onError: (error: Error) => {
      toast({ title: "Failed to create issue", description: error.message, variant: "destructive" });
    },
  });

  const rfiMutation = useMutation({
    mutationFn: async (issueId: string) => {
      const res = await fetch(`/api/bim-coordination/issues/${issueId}/rfi`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
        body: JSON.stringify({ toParty: "Design Team", fromParty: "BIM Coordinator" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bim-issues"] }),
    onError: (error: Error) => {
      toast({ title: "Failed to generate RFI", description: error.message, variant: "destructive" });
    },
  });

  // ── Filter & sort ────────────────────────────────────────────────────
  const issues = issuesQuery.data?.issues || [];

  const filtered = useMemo(() => {
    let result = [...issues];
    if (filterStatus !== "all") result = result.filter(i => i.status === filterStatus);
    if (filterPriority !== "all") result = result.filter(i => i.priority === filterPriority);
    if (filterOwner.trim()) {
      const o = filterOwner.toLowerCase();
      result = result.filter(i => (i.owner || "").toLowerCase().includes(o) || (i.assignedTo || "").toLowerCase().includes(o));
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "priority") cmp = a.priority.localeCompare(b.priority);
      else if (sortField === "status") cmp = a.status.localeCompare(b.status);
      else if (sortField === "createdDate") cmp = a.createdDate.localeCompare(b.createdDate);
      else if (sortField === "zone") cmp = (a.zone || "").localeCompare(b.zone || "");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [issues, filterStatus, filterPriority, filterOwner, sortField, sortDir]);

  // ── Summary stats ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const i of issues) {
      byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      byPriority[i.priority] = (byPriority[i.priority] || 0) + 1;
    }
    const open = issues.filter(i => !["RESOLVED", "WONT_FIX", "DUPLICATE"].includes(i.status)).length;
    const overdue = issues.filter(i => {
      if (["RESOLVED", "WONT_FIX", "DUPLICATE"].includes(i.status)) return false;
      return new Date(i.targetDate) < new Date();
    }).length;
    return { total: issues.length, open, overdue, byStatus, byPriority };
  }, [issues]);

  function toggleSort(field: string) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return null;
    return sortDir === "desc" ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronUp className="w-3 h-3 inline ml-0.5" />;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Issue Tracker</h2>
          <p className="text-sm text-muted-foreground">
            SOP Part 8 — 20-column issue log, 9-state workflow, RFI generation
          </p>
        </div>
        <CreateIssueDialog onCreate={(data) => createMutation.mutate(data)} />
      </div>

      {/* ── Summary Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-3 pb-2 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">Total</p>
            <p className="text-xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-3 pb-2 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">Open</p>
            <p className="text-xl font-bold">{stats.open}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="pt-3 pb-2 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">Overdue</p>
            <p className="text-xl font-bold">{stats.overdue}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="pt-3 pb-2 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">P1-P2</p>
            <p className="text-xl font-bold">{(stats.byPriority.P1 || 0) + (stats.byPriority.P2 || 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-3 pb-2 px-3">
            <p className="text-[10px] text-muted-foreground uppercase">Resolved</p>
            <p className="text-xl font-bold">{stats.byStatus.RESOLVED || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-44">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {ALL_STATUSES.map(s => (
                    <SelectItem key={s} value={s}>{s.replace(/_/g, " ")} ({stats.byStatus[s] || 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28">
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {["P1", "P2", "P3", "P4", "P5"].map(p => (
                    <SelectItem key={p} value={p}>{p} ({stats.byPriority[p] || 0})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <label className="text-xs font-medium text-muted-foreground">Owner</label>
              <Input className="h-8 text-xs" placeholder="Filter owner..." value={filterOwner} onChange={e => setFilterOwner(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground self-center">{filtered.length} of {issues.length}</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Issues Table ────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("priority")}>Pri <SortIcon field="priority" /></TableHead>
                  <TableHead>Issue #</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("status")}>Status <SortIcon field="status" /></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("zone")}>Zone <SortIcon field="zone" /></TableHead>
                  <TableHead>Discipline</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("createdDate")}>Created <SortIcon field="createdDate" /></TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>RFI</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(issue => {
                  const isOverdue = !["RESOLVED", "WONT_FIX", "DUPLICATE"].includes(issue.status) && new Date(issue.targetDate) < new Date();
                  return (
                    <TableRow key={issue.id} className={`text-xs ${isOverdue ? "bg-red-50" : ""}`}>
                      <TableCell><PriorityBadge priority={issue.priority} /></TableCell>
                      <TableCell className="font-mono text-[10px]">{issue.issueNumber}</TableCell>
                      <TableCell><StatusBadge status={issue.status} /></TableCell>
                      <TableCell className="max-w-[200px] truncate">{issue.name}</TableCell>
                      <TableCell>{issue.zone || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{(issue.originDiscipline || "").substring(0, 4).toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell className="truncate max-w-[80px]">{issue.owner || "—"}</TableCell>
                      <TableCell className="font-mono text-[10px]">{issue.createdDate.substring(0, 10)}</TableCell>
                      <TableCell className={`font-mono text-[10px] ${isOverdue ? "text-red-600 font-bold" : ""}`}>
                        {issue.targetDate.substring(0, 10)}
                        {isOverdue && <Clock className="w-3 h-3 inline ml-1 text-red-500" />}
                      </TableCell>
                      <TableCell>
                        {issue.rfiNumber ? (
                          <Badge variant="secondary" className="text-[10px]">{issue.rfiNumber}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <StatusTransitionDialog
                            issue={issue}
                            onTransition={(id, status, comment) =>
                              transitionMutation.mutate({ issueId: id, newStatus: status, comment })
                            }
                          />
                          {!issue.rfiNumber && !["RESOLVED", "WONT_FIX", "DUPLICATE"].includes(issue.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px] gap-1"
                              onClick={() => rfiMutation.mutate(issue.id)}
                              disabled={rfiMutation.isPending}
                            >
                              <Send className="w-3 h-3" /> RFI
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      No issues found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
