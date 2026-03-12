// client/src/components/bim-coordination/model-gate-panel.tsx
// =============================================================================
// MODEL GATE PANEL — SOP Part 2 Frontend
// =============================================================================
//
// Model drop gating interface:
//   - Select discipline and model to gate
//   - Run gating (POST /api/bim-coordination/model-gate)
//   - Display ACCEPTED / CONDITIONAL / REJECTED verdict
//   - Show 6 check scores with pass/fail indicators
//   - Remediation items list
//   - Gap register summary (GET /api/bim-coordination/gaps)
//
// Pattern: @tanstack/react-query + shadcn/ui + lucide-react
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileSearch,
  ArrowRight,
  Database,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface GateCheck {
  name: string;
  passed: boolean;
  score: number;
  threshold: number;
  actual: number;
  detail: string;
}

interface GateResult {
  verdict: "ACCEPTED" | "CONDITIONAL" | "REJECTED";
  discipline: string;
  modelId: string;
  dropDate: string;
  checks: GateCheck[];
  overallScore: number;
  remediationItems: string[];
  acceptedWithConditions: string[];
  summary: string;
}

interface GapRegister {
  projectName: string;
  generatedDate: string;
  gaps: GapRecord[];
  summary: {
    total: number;
    bySource: Record<string, number>;
    byLifecycle: Record<string, number>;
    rfisGenerated: number;
    closedCount: number;
    openCount: number;
    closureRate: number;
  };
}

interface GapRecord {
  id: string;
  source: string;
  discipline: string;
  parameter: string;
  elementName: string | null;
  level: string | null;
  description: string;
  impact: string;
  requiredAction: string;
  rfiNumber: string | null;
  lifecycle: string;
  detectedDate: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERDICT CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const VERDICT_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  ACCEPTED: { icon: CheckCircle2, color: "text-green-700", bg: "bg-green-100 border-green-400", label: "ACCEPTED" },
  CONDITIONAL: { icon: AlertTriangle, color: "text-amber-700", bg: "bg-amber-100 border-amber-400", label: "CONDITIONAL ACCEPT" },
  REJECTED: { icon: XCircle, color: "text-red-700", bg: "bg-red-100 border-red-400", label: "REJECTED" },
};

const DISCIPLINES = [
  { code: "ARC", name: "Architectural" },
  { code: "STR", name: "Structural" },
  { code: "MECH", name: "Mechanical" },
  { code: "PLBG", name: "Plumbing" },
  { code: "FP", name: "Fire Protection" },
  { code: "ELEC", name: "Electrical" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCORE GAUGE
// ═══════════════════════════════════════════════════════════════════════════════

function ScoreGauge({ score, size = 64 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 90 ? "#22c55e" : score >= 70 ? "#eab308" : score >= 50 ? "#f97316" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="transition-all duration-700"
        />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECK ITEM ROW
// ═══════════════════════════════════════════════════════════════════════════════

function CheckRow({ check }: { check: GateCheck }) {
  return (
    <div className={`flex items-center gap-3 p-2 rounded border ${check.passed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
      {check.passed ? (
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-red-600 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{check.name}</span>
          <span className={`text-xs font-mono ${check.passed ? "text-green-700" : "text-red-700"}`}>
            {check.actual}% / {check.threshold}%
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{check.detail}</p>
      </div>
      <ScoreGauge score={check.score} size={36} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ModelGatePanel() {
  const [modelId, setModelId] = useState("");
  const [discipline, setDiscipline] = useState("STR");

  // ── Gate mutation ────────────────────────────────────────────────────
  const gateMutation = useMutation<{ gate: GateResult; newGaps: number; totalGaps: number }>({
    mutationFn: async () => {
      const res = await fetch("/api/bim-coordination/model-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: modelId || "1", discipline }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  // ── Gap register query ───────────────────────────────────────────────
  const gapQuery = useQuery<GapRegister>({
    queryKey: ["bim-gaps"],
    queryFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = {};
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/gaps", { headers: ah, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load gaps");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const gateResult = gateMutation.data?.gate;
  const gapRegister = gapQuery.data;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold">Model Drop Gate</h2>
        <p className="text-sm text-muted-foreground">
          SOP Part 2 — Quality gate checks before model acceptance into coordination workflow
        </p>
      </div>

      {/* ── Gate Controls ───────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-36">
              <Label className="text-xs">Model ID</Label>
              <Input className="h-8 text-xs mt-1" value={modelId} onChange={e => setModelId(e.target.value)} placeholder="Enter model ID..." />
            </div>
            <div className="w-48">
              <Label className="text-xs">Discipline</Label>
              <Select value={discipline} onValueChange={setDiscipline}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DISCIPLINES.map(d => (
                    <SelectItem key={d.code} value={d.code}>{d.code} — {d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => gateMutation.mutate()}
              disabled={gateMutation.isPending}
              className="gap-1 h-8 text-xs"
            >
              {gateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
              Run Gate Check
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Gate Result ─────────────────────────────────────────────── */}
      {gateResult && (
        <>
          {/* Verdict Banner */}
          {(() => {
            const cfg = VERDICT_CONFIG[gateResult.verdict];
            const Icon = cfg.icon;
            return (
              <Card className={`border-2 ${cfg.bg}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-8 h-8 ${cfg.color}`} />
                      <div>
                        <p className={`text-lg font-bold ${cfg.color}`}>{cfg.label}</p>
                        <p className="text-xs text-muted-foreground">{gateResult.summary}</p>
                      </div>
                    </div>
                    <ScoreGauge score={gateResult.overallScore} size={72} />
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Checks */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Gate Checks ({gateResult.checks.filter(c => c.passed).length}/{gateResult.checks.length} passed)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {gateResult.checks.map(check => (
                  <CheckRow key={check.name} check={check} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Remediation */}
          {gateResult.remediationItems.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                  <XCircle className="w-4 h-4" /> Remediation Required ({gateResult.remediationItems.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {gateResult.remediationItems.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs p-2 bg-red-50 rounded">
                      <ArrowRight className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Conditions */}
          {gateResult.acceptedWithConditions.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Conditions ({gateResult.acceptedWithConditions.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {gateResult.acceptedWithConditions.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs p-2 bg-amber-50 rounded">
                      <ArrowRight className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* New gaps detected */}
          {gateMutation.data && gateMutation.data.newGaps > 0 && (
            <Card className="border-orange-200">
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <FileSearch className="w-4 h-4 text-orange-600" />
                  <span className="text-xs">
                    <strong>{gateMutation.data.newGaps}</strong> new gaps detected ({gateMutation.data.totalGaps} total in register)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Gap Register ────────────────────────────────────────────── */}
      {gapRegister && gapRegister.gaps.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4" />
              Gap Register — {gapRegister.summary.openCount} open, {gapRegister.summary.closedCount} closed
              ({gapRegister.summary.closureRate}% closure rate)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>ID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Element</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Lifecycle</TableHead>
                    <TableHead>RFI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gapRegister.gaps.slice(0, 20).map(gap => (
                    <TableRow key={gap.id} className="text-xs">
                      <TableCell className="font-mono text-[10px]">{gap.id}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px]">{gap.source}</Badge></TableCell>
                      <TableCell className="font-medium">{gap.parameter}</TableCell>
                      <TableCell className="truncate max-w-[120px]">{gap.elementName || "—"}</TableCell>
                      <TableCell>{gap.level || "—"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[9px]">{gap.requiredAction}</Badge></TableCell>
                      <TableCell>
                        <Badge
                          variant={gap.lifecycle === "CLOSED" ? "default" : "outline"}
                          className="text-[9px]"
                        >
                          {gap.lifecycle}
                        </Badge>
                      </TableCell>
                      <TableCell>{gap.rfiNumber || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {gapRegister.gaps.length > 20 && (
              <div className="p-2 text-center text-[10px] text-muted-foreground border-t">
                Showing 20 of {gapRegister.gaps.length} gaps
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Empty State ─────────────────────────────────────────────── */}
      {!gateResult && !gateMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Ready to Gate</h3>
            <p className="text-sm text-muted-foreground">Select a discipline and model ID, then run the quality gate.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
