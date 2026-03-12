// client/src/components/bim-coordination/governance-panel.tsx
// =============================================================================
// GOVERNANCE PANEL — SOP Part 13 Frontend
// =============================================================================
//
// Governance dashboard:
//   - Weekly cadence phase indicator (MODEL_DROP / CLASH_RUN / PACK_PREP / MEETING / ACTION)
//   - SLA tracking (ON_TRACK / AT_RISK / BREACHED with issue details)
//   - Meeting pack generation button
//   - Template integrity check
//   - Phase countdown timer
//
// Pattern: @tanstack/react-query + shadcn/ui + lucide-react
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Clock,
  CalendarCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Loader2,
  Shield,
  Timer,
  Users,
  ChevronRight,
  Download,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface GovernanceStatus {
  currentPhase: {
    phase: string;
    nextDeadline: string;
    hoursUntilDeadline: number;
  };
  issueSummary: {
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdue: number;
  };
  sla: {
    onTrack: number;
    atRisk: number;
    breached: number;
    escalationsRequired: number;
  };
  templateIntegrity: any;
}

interface SLAItem {
  issueId: string;
  issueNumber: string;
  priority: string;
  owner: string;
  ageInDays: number;
  targetDays: number;
  daysRemaining: number;
  percentElapsed: number;
  slaStatus: "ON_TRACK" | "AT_RISK" | "BREACHED";
  escalationRequired: boolean;
}

interface MeetingPack {
  pack: {
    meetingDate: string;
    meetingNumber: number;
    agenda: Array<{ order: number; topic: string; duration_min: number }>;
    statusSummary: any;
    slaOverview: any;
    topRisks: any[];
    milestoneAlerts: string[];
    trendAlerts: any[];
    actionItems: any[];
  };
  htmlSummary: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const PHASE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any; desc: string }> = {
  MODEL_DROP: { label: "Model Drop", color: "text-blue-700", bg: "bg-blue-100 border-blue-300", icon: Download, desc: "Disciplines uploading updated models" },
  CLASH_RUN: { label: "Clash Run", color: "text-purple-700", bg: "bg-purple-100 border-purple-300", icon: Shield, desc: "Automated clash detection in progress" },
  PACK_PREP: { label: "Pack Prep", color: "text-amber-700", bg: "bg-amber-100 border-amber-300", icon: FileText, desc: "Preparing meeting pack and reports" },
  MEETING: { label: "Meeting", color: "text-green-700", bg: "bg-green-100 border-green-300", icon: Users, desc: "Coordination meeting in progress or imminent" },
  ACTION_PERIOD: { label: "Action Period", color: "text-cyan-700", bg: "bg-cyan-100 border-cyan-300", icon: ChevronRight, desc: "Teams resolving assigned items" },
};

const SLA_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  ON_TRACK: { color: "text-green-700", bg: "bg-green-100", icon: CheckCircle2 },
  AT_RISK: { color: "text-amber-700", bg: "bg-amber-100", icon: AlertTriangle },
  BREACHED: { color: "text-red-700", bg: "bg-red-100", icon: XCircle },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function PhaseIndicator({ phase, hoursUntil, nextDeadline }: {
  phase: string;
  hoursUntil: number;
  nextDeadline: string;
}) {
  const config = PHASE_CONFIG[phase] || PHASE_CONFIG.ACTION_PERIOD;
  const Icon = config.icon;
  const allPhases = ["MODEL_DROP", "CLASH_RUN", "PACK_PREP", "MEETING", "ACTION_PERIOD"];
  const currentIdx = allPhases.indexOf(phase);

  return (
    <Card className={`border-2 ${config.bg}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${config.color}`} />
            <span className={`text-lg font-bold ${config.color}`}>{config.label}</span>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-sm font-mono">
              <Timer className="w-4 h-4" />
              <span className={hoursUntil < 4 ? "text-red-600 font-bold" : ""}>{hoursUntil.toFixed(1)}h</span>
            </div>
            <p className="text-[10px] text-muted-foreground">until next deadline</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{config.desc}</p>

        {/* Phase timeline */}
        <div className="flex gap-1">
          {allPhases.map((p, idx) => {
            const pConfig = PHASE_CONFIG[p];
            const isActive = idx === currentIdx;
            const isPast = idx < currentIdx;
            return (
              <div key={p} className="flex-1">
                <div className={`h-1.5 rounded-full transition-colors ${
                  isActive ? "bg-blue-600" : isPast ? "bg-green-400" : "bg-gray-200"
                }`} />
                <p className={`text-[9px] mt-0.5 text-center truncate ${
                  isActive ? "font-bold text-blue-700" : "text-muted-foreground"
                }`}>{pConfig.label}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLA PROGRESS BAR
// ═══════════════════════════════════════════════════════════════════════════════

function SLAProgressBar({ item }: { item: SLAItem }) {
  const pct = Math.min(100, item.percentElapsed);
  const color = item.slaStatus === "BREACHED" ? "bg-red-500" : item.slaStatus === "AT_RISK" ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="w-24">
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[9px] text-muted-foreground mt-0.5">{item.ageInDays}d / {item.targetDays}d</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function GovernancePanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [showMeetingPack, setShowMeetingPack] = useState(false);

  // ── Governance status ────────────────────────────────────────────────
  const govQuery = useQuery<GovernanceStatus>({
    queryKey: ["bim-governance"],
    queryFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = {};
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/governance", { headers: ah, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load governance");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // ── SLA items ────────────────────────────────────────────────────────
  const slaQuery = useQuery<{ total: number; items: SLAItem[] }>({
    queryKey: ["bim-sla"],
    queryFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = {};
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/sla", { headers: ah, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load SLA");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // ── Meeting pack mutation ────────────────────────────────────────────
  const meetingPackMutation = useMutation<MeetingPack>({
    mutationFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = { "Content-Type": "application/json" };
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/meeting-pack", {
        method: "POST",
        headers: ah,
        credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to generate meeting pack");
      return res.json();
    },
    onSuccess: () => setShowMeetingPack(true),
  });

  const gov = govQuery.data;
  const slaItems = slaQuery.data?.items || [];
  const pack = meetingPackMutation.data;

  if (!gov) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Governance Dashboard</h3>
          <p className="text-sm text-muted-foreground">Loading governance status...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Governance Dashboard</h2>
          <p className="text-sm text-muted-foreground">SOP Part 13 — Weekly cadence, SLA tracking, meeting management</p>
        </div>
        <Button
          onClick={() => meetingPackMutation.mutate()}
          disabled={meetingPackMutation.isPending}
          className="gap-1 h-8 text-xs"
        >
          {meetingPackMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          Generate Meeting Pack
        </Button>
      </div>

      {/* ── Phase Indicator ─────────────────────────────────────────── */}
      <PhaseIndicator
        phase={gov.currentPhase.phase}
        hoursUntil={gov.currentPhase.hoursUntilDeadline}
        nextDeadline={gov.currentPhase.nextDeadline}
      />

      {/* ── SLA Summary Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["ON_TRACK", "AT_RISK", "BREACHED"] as const).map(status => {
          const cfg = SLA_CONFIG[status];
          const Icon = cfg.icon;
          const count = status === "ON_TRACK" ? gov.sla.onTrack : status === "AT_RISK" ? gov.sla.atRisk : gov.sla.breached;
          return (
            <Card key={status}>
              <CardContent className="pt-3 pb-2 px-3">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className={`w-3 h-3 ${cfg.color}`} />
                  <span className="text-[10px] text-muted-foreground uppercase">{status.replace(/_/g, " ")}</span>
                </div>
                <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
              </CardContent>
            </Card>
          );
        })}
        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-1 mb-1">
              <AlertTriangle className="w-3 h-3 text-red-600" />
              <span className="text-[10px] text-muted-foreground uppercase">Escalations</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{gov.sla.escalationsRequired}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── SLA Detail Table ────────────────────────────────────────── */}
      {slaItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" /> SLA Tracking ({slaItems.length} open issues)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Issue</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead className="text-right">Days Left</TableHead>
                    <TableHead>Escalation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slaItems.slice(0, 20).map(item => {
                    const cfg = SLA_CONFIG[item.slaStatus];
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={item.issueId} className="text-xs">
                        <TableCell className="font-mono text-[10px]">{item.issueNumber}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${
                            item.priority <= "P2" ? "bg-red-600 text-white" : "bg-gray-200"
                          }`}>{item.priority}</span>
                        </TableCell>
                        <TableCell className="truncate max-w-[80px]">{item.owner}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${cfg.color}`}>
                            <Icon className="w-3 h-3" />
                            {item.slaStatus.replace(/_/g, " ")}
                          </span>
                        </TableCell>
                        <TableCell><SLAProgressBar item={item} /></TableCell>
                        <TableCell className={`text-right font-mono ${item.daysRemaining <= 2 ? "text-red-600 font-bold" : ""}`}>
                          {item.daysRemaining}d
                        </TableCell>
                        <TableCell>
                          {item.escalationRequired && (
                            <Badge variant="destructive" className="text-[9px]">ESCALATE</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Meeting Pack Preview ────────────────────────────────────── */}
      {showMeetingPack && pack && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarCheck className="w-4 h-4" />
                Meeting Pack #{pack.pack.meetingNumber} — {pack.pack.meetingDate}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setShowMeetingPack(false)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Agenda */}
            <div className="mb-4">
              <h4 className="text-xs font-medium mb-2">Agenda</h4>
              <div className="space-y-1">
                {pack.pack.agenda.map(item => (
                  <div key={item.order} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] flex items-center justify-center font-bold">
                      {item.order}
                    </span>
                    <span className="flex-1">{item.topic}</span>
                    <span className="text-muted-foreground">{item.duration_min}min</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Summary */}
            <div className="grid grid-cols-5 gap-2 mb-4">
              {[
                { label: "Open", value: pack.pack.statusSummary.totalOpen },
                { label: "New", value: pack.pack.statusSummary.newSinceLastMeeting },
                { label: "Resolved", value: pack.pack.statusSummary.resolvedSinceLastMeeting },
                { label: "Overdue", value: pack.pack.statusSummary.overdue },
                { label: "Regressions", value: pack.pack.statusSummary.regressions },
              ].map(s => (
                <div key={s.label} className="text-center p-2 bg-muted/30 rounded">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-bold">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Milestone Alerts */}
            {pack.pack.milestoneAlerts.length > 0 && (
              <div className="space-y-1 mb-4">
                <h4 className="text-xs font-medium">Milestone Alerts</h4>
                {pack.pack.milestoneAlerts.map((alert, idx) => (
                  <div key={idx} className="text-[10px] text-red-700 bg-red-50 p-2 rounded flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    {alert}
                  </div>
                ))}
              </div>
            )}

            {/* Top Risks */}
            {pack.pack.topRisks.length > 0 && (
              <div>
                <h4 className="text-xs font-medium mb-2">Top 10 Risks</h4>
                <div className="space-y-1">
                  {pack.pack.topRisks.slice(0, 10).map((risk, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-[10px] p-1 border rounded">
                      <span className={`w-6 h-4 rounded text-center text-[9px] font-bold ${
                        risk.priority <= "P2" ? "bg-red-600 text-white" : "bg-gray-200"
                      }`}>{risk.priority}</span>
                      <span className="font-mono">{risk.issueNumber}</span>
                      <span className="flex-1 truncate">{risk.name}</span>
                      <span className="text-muted-foreground">{risk.zone}</span>
                      <span className={risk.daysRemaining <= 0 ? "text-red-600 font-bold" : ""}>{risk.daysRemaining}d</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
