// client/src/components/bim-coordination/trend-chart-panel.tsx
// =============================================================================
// TREND CHART PANEL — SOP Part 10 Frontend
// =============================================================================
//
// Trend analytics visualization:
//   - Burndown chart (new vs resolved per drop)
//   - Velocity metrics display
//   - Hotspot zone heatmap (risk-level colored)
//   - Root-cause trend indicators
//   - Alert list (critical/warning/info)
//
// Pattern: @tanstack/react-query + shadcn/ui + recharts + lucide-react
// =============================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  AlertCircle,
  Info,
  Flame,
  Activity,
  BarChart3,
  Target,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface TrendReport {
  generatedDate: string;
  dropCount: number;
  dataPoints: TrendDataPoint[];
  velocity: VelocityMetrics;
  burndownTargets: BurndownTarget[];
  hotspots: HotspotZone[];
  rootCauseTrends: RootCauseTrend[];
  alerts: TrendAlert[];
}

interface TrendDataPoint {
  runId: string;
  date: string;
  total: number;
  newCount: number;
  resolvedCount: number;
  persistentCount: number;
  regressionCount: number;
  netChange: number;
}

interface VelocityMetrics {
  avgNewPerDrop: number;
  avgResolvedPerDrop: number;
  netVelocity: number;
  resolutionRate: number;
  regressionRate: number;
  trend: "improving" | "stable" | "degrading";
}

interface BurndownTarget {
  milestoneDate: string;
  milestoneName: string;
  currentOpen: number;
  requiredWeeklyRate: number;
  projectedCompletion: string | null;
  onTrack: boolean;
}

interface HotspotZone {
  zone: string;
  totalClashes: number;
  newClashes: number;
  persistentClashes: number;
  regressionClashes: number;
  dominantDiscipline: string;
  riskLevel: "critical" | "high" | "medium" | "low";
  suggestedAction: string;
}

interface RootCauseTrend {
  rootCauseType: string;
  occurrencesByDrop: number[];
  trend: "increasing" | "stable" | "decreasing";
  isLeadingIndicator: boolean;
  preventiveAction: string;
}

interface TrendAlert {
  level: "critical" | "warning" | "info";
  message: string;
  metric: string;
  value: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const TREND_ICONS: Record<string, any> = { improving: TrendingDown, stable: Minus, degrading: TrendingUp };
const TREND_COLORS: Record<string, string> = { improving: "text-green-600", stable: "text-gray-500", degrading: "text-red-600" };
const RISK_COLORS: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-green-500" };
const ALERT_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, color: "text-red-700", bg: "bg-red-50 border-red-200" },
  warning: { icon: AlertCircle, color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  info: { icon: Info, color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
};

function VelocityCard({ label, value, unit, good }: { label: string; value: number; unit: string; good?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${good === true ? "text-green-600" : good === false ? "text-red-600" : ""}`}>
        {value}{unit}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function TrendChartPanel() {
  const [activeTab, setActiveTab] = useState<"burndown" | "hotspots" | "rootcause">("burndown");

  const trendQuery = useQuery<TrendReport>({
    queryKey: ["bim-trends"],
    queryFn: async () => {
      const tk = localStorage.getItem("auth_token");
      const ah: Record<string, string> = {};
      if (tk) ah["Authorization"] = `Bearer ${tk}`;
      const res = await fetch("/api/bim-coordination/trends", { headers: ah, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trends");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const report = trendQuery.data;
  if (!report) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Trend Data Yet</h3>
          <p className="text-sm text-muted-foreground">Run at least 2 clash detections to see trends.</p>
        </CardContent>
      </Card>
    );
  }

  const vel = report.velocity;
  const TrendIcon = TREND_ICONS[vel.trend] || Minus;
  const trendColor = TREND_COLORS[vel.trend] || TREND_COLORS.stable;

  // Chart data
  const chartData = report.dataPoints.map((dp, idx) => ({
    name: `Drop ${idx + 1}`,
    date: dp.date.substring(0, 10),
    new: dp.newCount,
    resolved: dp.resolvedCount,
    persistent: dp.persistentCount,
    regression: dp.regressionCount,
    total: dp.total,
    net: dp.netChange,
  }));

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Trend Analytics</h2>
          <p className="text-sm text-muted-foreground">
            SOP Part 10 — {report.dropCount} model drops analyzed
          </p>
        </div>
        <div className={`flex items-center gap-2 ${trendColor}`}>
          <TrendIcon className="w-5 h-5" />
          <span className="text-sm font-medium capitalize">{vel.trend}</span>
        </div>
      </div>

      {/* ── Velocity Metrics ────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="grid grid-cols-5 gap-4">
            <VelocityCard label="Avg New/Drop" value={vel.avgNewPerDrop} unit="" />
            <VelocityCard label="Avg Resolved/Drop" value={vel.avgResolvedPerDrop} unit="" good={vel.avgResolvedPerDrop > vel.avgNewPerDrop} />
            <VelocityCard label="Net Velocity" value={vel.netVelocity} unit="/drop" good={vel.netVelocity <= 0} />
            <VelocityCard label="Resolution Rate" value={Math.round(vel.resolutionRate * 100)} unit="%" good={vel.resolutionRate > 0.5} />
            <VelocityCard label="Regression Rate" value={Math.round(vel.regressionRate * 100)} unit="%" good={vel.regressionRate < 0.05} />
          </div>
        </CardContent>
      </Card>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {report.alerts.length > 0 && (
        <div className="space-y-2">
          {report.alerts.map((alert, idx) => {
            const cfg = ALERT_CONFIG[alert.level] || ALERT_CONFIG.info;
            const Icon = cfg.icon;
            return (
              <div key={idx} className={`flex items-start gap-2 p-3 rounded-md border ${cfg.bg}`}>
                <Icon className={`w-4 h-4 mt-0.5 ${cfg.color}`} />
                <span className={`text-xs ${cfg.color}`}>{alert.message}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab Navigation ──────────────────────────────────────────── */}
      <div className="flex gap-1 border-b">
        {(["burndown", "hotspots", "rootcause"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "burndown" ? "Burndown" : tab === "hotspots" ? "Hotspots" : "Root Causes"}
          </button>
        ))}
      </div>

      {/* ── Burndown Chart ──────────────────────────────────────────── */}
      {activeTab === "burndown" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">New vs Resolved per Drop</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="new" fill="#ef4444" name="New" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="resolved" fill="#22c55e" name="Resolved" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="regression" fill="#f97316" name="Regression" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Total Open Clashes Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="#93c5fd" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Burndown targets */}
          {report.burndownTargets.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" /> Milestone Burndown Targets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {report.burndownTargets.map((bt, idx) => (
                    <div key={idx} className={`flex items-center justify-between p-2 rounded text-xs ${bt.onTrack ? "bg-green-50" : "bg-red-50"}`}>
                      <div>
                        <span className="font-medium">{bt.milestoneName}</span>
                        <span className="text-muted-foreground ml-2">({bt.milestoneDate})</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span>{bt.currentOpen} open</span>
                        <span>{bt.requiredWeeklyRate}/week needed</span>
                        <Badge variant={bt.onTrack ? "default" : "destructive"} className="text-[10px]">
                          {bt.onTrack ? "ON TRACK" : "AT RISK"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Hotspot Zones ───────────────────────────────────────────── */}
      {activeTab === "hotspots" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Flame className="w-4 h-4" /> Hotspot Zones
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.hotspots.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No hotspot data available</p>
            ) : (
              <div className="space-y-2">
                {report.hotspots.map((hs, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-md border">
                    <div className={`w-3 h-3 rounded-full mt-0.5 ${RISK_COLORS[hs.riskLevel]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{hs.zone}</span>
                        <Badge variant="outline" className="text-[10px]">{hs.riskLevel.toUpperCase()}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{hs.dominantDiscipline}</Badge>
                      </div>
                      <div className="flex gap-4 mt-1 text-[10px] text-muted-foreground">
                        <span>Total: {hs.totalClashes}</span>
                        <span>New: {hs.newClashes}</span>
                        <span>Persistent: {hs.persistentClashes}</span>
                        {hs.regressionClashes > 0 && (
                          <span className="text-red-600 font-medium">Regressions: {hs.regressionClashes}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">{hs.suggestedAction}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Root Cause Trends ───────────────────────────────────────── */}
      {activeTab === "rootcause" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" /> Root-Cause Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            {report.rootCauseTrends.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Need 2+ drops for trend analysis</p>
            ) : (
              <div className="space-y-3">
                {report.rootCauseTrends.map((rc, idx) => {
                  const TIcon = TREND_ICONS[rc.trend] || Minus;
                  const tColor = TREND_COLORS[rc.trend] || TREND_COLORS.stable;
                  return (
                    <div key={idx} className="p-3 rounded-md border">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{rc.rootCauseType.replace(/_/g, " ")}</span>
                          {rc.isLeadingIndicator && (
                            <Badge variant="destructive" className="text-[10px]">LEADING INDICATOR</Badge>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 ${tColor}`}>
                          <TIcon className="w-3 h-3" />
                          <span className="text-xs capitalize">{rc.trend}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 mt-2">
                        {rc.occurrencesByDrop.map((count, dropIdx) => (
                          <div
                            key={dropIdx}
                            className="flex-1 bg-blue-100 rounded-sm relative"
                            style={{ height: `${Math.max(4, count * 4)}px`, maxHeight: "40px" }}
                            title={`Drop ${dropIdx + 1}: ${count}`}
                          />
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">{rc.preventiveAction}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
