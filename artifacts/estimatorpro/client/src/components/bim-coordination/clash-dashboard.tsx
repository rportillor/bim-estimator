// client/src/components/bim-coordination/clash-dashboard.tsx
// =============================================================================
// CLASH DETECTION DASHBOARD — SOP Part 7 Frontend
// =============================================================================
//
// Main clash detection interface:
//   - Run clash detection (POST /api/bim-coordination/clash-run)
//   - View results by run (GET /api/bim-coordination/clashes/:runId)
//   - Clash group table with severity, zone, discipline breakdown
//   - Filter by severity, category, discipline, zone
//   - Quick-create issues from groups
//
// Pattern: @tanstack/react-query + shadcn/ui + wouter + lucide-react
// =============================================================================

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  AlertTriangle,
  Play,
  Filter,
  RefreshCw,
  Shield,
  Zap,
  Eye,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ClashRunResult {
  runId: string;
  totalClashes: number;
  afterFilter: number;
  filtered: number;
  uniqueGroups: number;
  issuesCreated: number;
  gapsDetected: number;
  summary: any;
  filterSummary: any;
  dedupSummary: any;
}

interface ClashGroup {
  groupId: string;
  rootCauseElement: string;
  rootCauseType: string;
  rootCauseDiscipline: string;
  zone: string;
  description: string;
  clashCount: number;
  severity: string;
  affectedDisciplines: string[];
}

interface ClashRunDetail {
  clashes: any[];
  groups: ClashGroup[];
  filterSummary: any;
  dedupSummary: any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  critical: { color: "text-red-700", bg: "bg-red-100 border-red-300", icon: XCircle },
  high: { color: "text-orange-700", bg: "bg-orange-100 border-orange-300", icon: AlertTriangle },
  medium: { color: "text-yellow-700", bg: "bg-yellow-100 border-yellow-300", icon: AlertCircle },
  low: { color: "text-blue-700", bg: "bg-blue-100 border-blue-300", icon: Eye },
  info: { color: "text-gray-600", bg: "bg-gray-100 border-gray-300", icon: CheckCircle2 },
};

function SeverityBadge({ severity }: { severity: string }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${config.bg} ${config.color}`}>
      <Icon className="w-3 h-3" />
      {severity.toUpperCase()}
    </span>
  );
}

function _CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    hard: "bg-red-600 text-white",
    soft: "bg-amber-500 text-white",
    code_compliance: "bg-purple-600 text-white",
    access: "bg-blue-600 text-white",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[category] || "bg-gray-500 text-white"}`}>
      {category.replace("_", " ").toUpperCase()}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ═══════════════════════════════════════════════════════════════════════════════

function StatCard({ title, value, subtitle, icon: Icon, variant = "default" }: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: any;
  variant?: "default" | "critical" | "success" | "warning";
}) {
  const variants: Record<string, string> = {
    default: "border-l-4 border-l-blue-500",
    critical: "border-l-4 border-l-red-500",
    success: "border-l-4 border-l-green-500",
    warning: "border-l-4 border-l-amber-500",
  };
  return (
    <Card className={variants[variant]}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface ClashDashboardProps {
  projectId?: string;
  modelId?: string;
}

export default function ClashDashboard({ projectId, modelId }: ClashDashboardProps) {
  const params = useParams();
  const resolvedProjectId = projectId || params.projectId || "1";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // State
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterCategory, _setFilterCategory] = useState<string>("all");
  const [filterDiscipline, setFilterDiscipline] = useState<string>("all");
  const [filterZone, setFilterZone] = useState<string>("");
  const [sortField, setSortField] = useState<string>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // ── Run clash detection mutation ──────────────────────────────────────
  const runClashMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/bim-coordination/clash-run", {
        modelId: modelId || resolvedProjectId,
        projectId: resolvedProjectId,
      });
      return res.json() as Promise<ClashRunResult>;
    },
    onSuccess: (data) => {
      setActiveRunId(data.runId);
      queryClient.invalidateQueries({ queryKey: ["clash-run"] });
    },
    onError: (error: Error) => {
      toast({ title: "Clash detection failed", description: error.message, variant: "destructive" });
    },
  });

  // ── Fetch run details ────────────────────────────────────────────────
  const runDetailQuery = useQuery<ClashRunDetail>({
    queryKey: ["clash-run", activeRunId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/bim-coordination/clashes/${activeRunId}`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load clash results");
      return res.json();
    },
    enabled: !!activeRunId,
  });

  // ── Create issue from group mutation ─────────────────────────────────
  const createIssueMutation = useMutation({
    mutationFn: async (group: ClashGroup) => {
      const res = await apiRequest("POST", "/api/bim-coordination/issues", {
        clashGroupId: group.groupId,
        name: group.description,
        zone: group.zone,
        originDiscipline: group.rootCauseDiscipline,
        type: group.rootCauseType,
      });
      return res.json();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create issue", description: error.message, variant: "destructive" });
    },
  });

  // ── Filter + sort groups ─────────────────────────────────────────────
  const groups = runDetailQuery.data?.groups || [];

  const filteredGroups = useMemo(() => {
    let result = [...groups];

    if (filterSeverity !== "all") {
      result = result.filter(g => g.severity === filterSeverity);
    }
    if (filterDiscipline !== "all") {
      result = result.filter(g =>
        g.rootCauseDiscipline === filterDiscipline ||
        g.affectedDisciplines.includes(filterDiscipline)
      );
    }
    if (filterZone.trim()) {
      const z = filterZone.toLowerCase();
      result = result.filter(g => g.zone.toLowerCase().includes(z));
    }

    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "severity") {
        cmp = (severityOrder[a.severity] || 5) - (severityOrder[b.severity] || 5);
      } else if (sortField === "clashCount") {
        cmp = a.clashCount - b.clashCount;
      } else if (sortField === "zone") {
        cmp = a.zone.localeCompare(b.zone);
      } else if (sortField === "discipline") {
        cmp = a.rootCauseDiscipline.localeCompare(b.rootCauseDiscipline);
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [groups, filterSeverity, filterCategory, filterDiscipline, filterZone, sortField, sortDir]);

  // ── Unique values for filters ────────────────────────────────────────
  const uniqueDisciplines = useMemo(() => {
    const set = new Set<string>();
    groups.forEach(g => {
      set.add(g.rootCauseDiscipline);
      g.affectedDisciplines.forEach(d => set.add(d));
    });
    return Array.from(set).sort();
  }, [groups]);

  // ── Sort toggle ──────────────────────────────────────────────────────
  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return null;
    return sortDir === "desc"
      ? <ChevronDown className="w-3 h-3 inline ml-0.5" />
      : <ChevronUp className="w-3 h-3 inline ml-0.5" />;
  }

  // ── Run result from mutation ─────────────────────────────────────────
  const latestRun = runClashMutation.data;

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Clash Detection Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            SOP Part 7 — Selection sets, spatial tests, false-positive filtering, deduplication
          </p>
        </div>
        <Button
          onClick={() => runClashMutation.mutate()}
          disabled={runClashMutation.isPending}
          className="gap-2"
        >
          {runClashMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run Clash Detection
        </Button>
      </div>

      {/* ── Run Result Summary Cards ──────────────────────────────────── */}
      {latestRun && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard title="Raw Clashes" value={latestRun.totalClashes} icon={Zap} variant="warning" />
          <StatCard title="After Filter" value={latestRun.afterFilter} subtitle={`${latestRun.filtered} removed`} icon={Filter} />
          <StatCard title="Unique Groups" value={latestRun.uniqueGroups} icon={Shield} variant={latestRun.uniqueGroups > 20 ? "critical" : "default"} />
          <StatCard title="Issues Created" value={latestRun.issuesCreated} icon={AlertTriangle} variant="success" />
          <StatCard title="Gaps Detected" value={latestRun.gapsDetected} icon={AlertCircle} variant={latestRun.gapsDetected > 0 ? "warning" : "default"} />
          <StatCard title="Run ID" value={latestRun.runId.substring(0, 12)} icon={RefreshCw} />
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────── */}
      {groups.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="w-40">
                <label className="text-xs font-medium text-muted-foreground">Severity</label>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <label className="text-xs font-medium text-muted-foreground">Discipline</label>
                <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Disciplines</SelectItem>
                    {uniqueDisciplines.map(d => (
                      <SelectItem key={d} value={d}>{d.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <label className="text-xs font-medium text-muted-foreground">Zone</label>
                <Input
                  className="h-8 text-xs"
                  placeholder="Filter by zone..."
                  value={filterZone}
                  onChange={e => setFilterZone(e.target.value)}
                />
              </div>
              <div className="text-xs text-muted-foreground self-center">
                {filteredGroups.length} of {groups.length} groups
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Clash Groups Table ────────────────────────────────────────── */}
      {groups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Clash Groups</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("severity")}>
                      Severity <SortIcon field="severity" />
                    </TableHead>
                    <TableHead>Group ID</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("discipline")}>
                      Root Cause <SortIcon field="discipline" />
                    </TableHead>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("zone")}>
                      Zone <SortIcon field="zone" />
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("clashCount")}>
                      Clashes <SortIcon field="clashCount" />
                    </TableHead>
                    <TableHead>Affected</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((group, idx) => (
                    <TableRow
                      key={group.groupId}
                      className={`text-xs ${expandedGroup === group.groupId ? "bg-muted/50" : ""}`}
                    >
                      <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell><SeverityBadge severity={group.severity} /></TableCell>
                      <TableCell className="font-mono text-xs">{group.groupId.substring(0, 16)}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{group.description}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {group.rootCauseDiscipline.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>{group.zone || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{group.clashCount}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {group.affectedDisciplines.slice(0, 3).map(d => (
                            <Badge key={d} variant="secondary" className="text-[10px]">
                              {d.substring(0, 4).toUpperCase()}
                            </Badge>
                          ))}
                          {group.affectedDisciplines.length > 3 && (
                            <Badge variant="secondary" className="text-[10px]">
                              +{group.affectedDisciplines.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => setExpandedGroup(
                              expandedGroup === group.groupId ? null : group.groupId
                            )}
                          >
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => createIssueMutation.mutate(group)}
                            disabled={createIssueMutation.isPending}
                          >
                            <AlertTriangle className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredGroups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {groups.length > 0
                          ? "No groups match current filters"
                          : "Run clash detection to see results"
                        }
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Empty State ──────────────────────────────────────────────── */}
      {!latestRun && !runClashMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Clash Detection Results</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run clash detection to analyze model coordination across all disciplines.
            </p>
            <Button onClick={() => runClashMutation.mutate()} className="gap-2">
              <Play className="w-4 h-4" /> Run Clash Detection
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Error State ──────────────────────────────────────────────── */}
      {runClashMutation.isError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-red-700">
              <XCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Clash detection failed</span>
            </div>
            <p className="text-xs text-red-600 mt-1">
              {(runClashMutation.error as Error).message}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
