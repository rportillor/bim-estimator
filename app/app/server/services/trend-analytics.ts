/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  TREND ANALYTICS — SOP Part 10
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Analyses trends across multiple model drops:
 *    1. Counts by type/priority per drop (new vs resolved velocity)
 *    2. Regression rate tracking
 *    3. Burndown by milestone (weekly closure targets, exposure tracking)
 *    4. Root-cause trend analytics (hotspot zones, leading indicators)
 *    5. Preventive action suggestions
 *
 *  Standards: CIQS, ISO 19650, Earned Value concepts
 *  Consumed by: governance-engine.ts, bim-coordination-router.ts, frontend panels
 *  Depends on:  delta-tracker.ts (DeltaSummary, DropHistory)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { DeltaSummary } from './delta-tracker';
import type { ClashSeverity } from './clash-detection-engine';
import type { IssueRecord, IssuePriority } from './issue-log';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrendDataPoint {
  runId: string;
  date: string;
  total: number;
  newCount: number;
  resolvedCount: number;
  persistentCount: number;
  regressionCount: number;
  netChange: number;
}

export interface BurndownTarget {
  milestoneDate: string;
  milestoneName: string;
  targetZero: boolean;
  currentOpen: number;
  requiredWeeklyRate: number;
  projectedCompletion: string | null;
  onTrack: boolean;
}

export interface VelocityMetrics {
  avgNewPerDrop: number;
  avgResolvedPerDrop: number;
  netVelocity: number;
  resolutionRate: number;
  regressionRate: number;
  trend: 'improving' | 'stable' | 'degrading';
}

export interface HotspotZone {
  zone: string;
  totalClashes: number;
  newClashes: number;
  persistentClashes: number;
  regressionClashes: number;
  dominantDiscipline: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  suggestedAction: string;
}

export interface RootCauseTrend {
  rootCauseType: string;
  occurrencesByDrop: number[];
  trend: 'increasing' | 'stable' | 'decreasing';
  isLeadingIndicator: boolean;
  preventiveAction: string;
}

export interface TrendReport {
  generatedDate: string;
  dropCount: number;
  dataPoints: TrendDataPoint[];
  velocity: VelocityMetrics;
  burndownTargets: BurndownTarget[];
  hotspots: HotspotZone[];
  rootCauseTrends: RootCauseTrend[];
  alerts: TrendAlert[];
}

export interface TrendAlert {
  level: 'critical' | 'warning' | 'info';
  message: string;
  metric: string;
  value: number;
  threshold: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TREND DATA POINTS
// ═══════════════════════════════════════════════════════════════════════════════

export function buildTrendDataPoints(deltas: DeltaSummary[]): TrendDataPoint[] {
  return deltas.map(d => ({
    runId: d.runId,
    date: d.runDate,
    total: d.totalCurrent,
    newCount: d.newCount,
    resolvedCount: d.resolvedCount,
    persistentCount: d.persistentCount,
    regressionCount: d.regressionCount,
    netChange: d.netChange,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. VELOCITY METRICS
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateVelocity(deltas: DeltaSummary[]): VelocityMetrics {
  if (deltas.length === 0) {
    return {
      avgNewPerDrop: 0, avgResolvedPerDrop: 0, netVelocity: 0,
      resolutionRate: 0, regressionRate: 0, trend: 'stable',
    };
  }

  const totalNew = deltas.reduce((s, d) => s + d.newCount, 0);
  const totalResolved = deltas.reduce((s, d) => s + d.resolvedCount, 0);
  const totalPersistent = deltas.reduce((s, d) => s + d.persistentCount, 0);
  const totalRegression = deltas.reduce((s, d) => s + d.regressionCount, 0);
  const totalAll = totalNew + totalResolved + totalPersistent + totalRegression;
  const n = deltas.length;

  const avgNew = totalNew / n;
  const avgResolved = totalResolved / n;
  const netVelocity = avgNew - avgResolved;
  const resolutionRate = (totalResolved + totalPersistent) > 0
    ? totalResolved / (totalResolved + totalPersistent)
    : 0;
  const regressionRate = totalAll > 0 ? totalRegression / totalAll : 0;

  let trend: 'improving' | 'stable' | 'degrading' = 'stable';
  if (n >= 4) {
    const recentNet = deltas.slice(-3).reduce((s, d) => s + d.netChange, 0) / 3;
    const earlyNet = deltas.slice(0, 3).reduce((s, d) => s + d.netChange, 0) / 3;
    if (recentNet < earlyNet - 2) trend = 'improving';
    else if (recentNet > earlyNet + 2) trend = 'degrading';
  }

  return {
    avgNewPerDrop: Math.round(avgNew * 10) / 10,
    avgResolvedPerDrop: Math.round(avgResolved * 10) / 10,
    netVelocity: Math.round(netVelocity * 10) / 10,
    resolutionRate: Math.round(resolutionRate * 1000) / 1000,
    regressionRate: Math.round(regressionRate * 1000) / 1000,
    trend,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. BURNDOWN TARGETS
// ═══════════════════════════════════════════════════════════════════════════════

export interface MilestoneDefinition {
  name: string;
  date: string;
  targetZeroClashes: boolean;
}

export function calculateBurndown(
  currentOpenCount: number,
  velocity: VelocityMetrics,
  milestones: MilestoneDefinition[],
): BurndownTarget[] {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  return milestones.map(ms => {
    const msDate = new Date(ms.date).getTime();
    const weeksRemaining = Math.max(1, Math.ceil((msDate - now) / weekMs));
    const requiredWeeklyRate = ms.targetZeroClashes
      ? Math.ceil(currentOpenCount / weeksRemaining)
      : Math.ceil((currentOpenCount * 0.8) / weeksRemaining);

    let projectedCompletion: string | null = null;
    let onTrack = true;

    if (velocity.avgResolvedPerDrop > 0) {
      const weeksToZero = Math.ceil(currentOpenCount / velocity.avgResolvedPerDrop);
      const projMs = now + weeksToZero * weekMs;
      projectedCompletion = new Date(projMs).toISOString().substring(0, 10);
      onTrack = projMs <= msDate;
    } else if (currentOpenCount > 0) {
      onTrack = false;
    }

    return {
      milestoneDate: ms.date,
      milestoneName: ms.name,
      targetZero: ms.targetZeroClashes,
      currentOpen: currentOpenCount,
      requiredWeeklyRate,
      projectedCompletion,
      onTrack,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. HOTSPOT ZONES
// ═══════════════════════════════════════════════════════════════════════════════

export function identifyHotspots(deltas: DeltaSummary[]): HotspotZone[] {
  if (deltas.length === 0) return [];

  const latest = deltas[deltas.length - 1];
  const zoneData = latest.byZone;
  if (!zoneData) return [];

  const hotspots: HotspotZone[] = [];

  for (const [zone, counts] of Object.entries(zoneData)) {
    const total = (counts.new || 0) + (counts.persistent || 0) + (counts.regression || 0);
    if (total === 0) continue;

    let riskLevel: HotspotZone['riskLevel'] = 'low';
    if ((counts.regression || 0) > 0 || total > 20) riskLevel = 'critical';
    else if (total > 10) riskLevel = 'high';
    else if (total > 5) riskLevel = 'medium';

    const dominantDiscipline = findDominantDiscipline(latest, zone);

    let suggestedAction = 'Monitor — within acceptable range';
    if (riskLevel === 'critical') {
      suggestedAction = `URGENT: Zone ${zone} has ${counts.regression || 0} regressions and ${total} active clashes — schedule dedicated coordination session`;
    } else if (riskLevel === 'high') {
      suggestedAction = `Zone ${zone} trending high — review ${dominantDiscipline} routing in next coordination meeting`;
    } else if (riskLevel === 'medium') {
      suggestedAction = `Zone ${zone} requires attention — include in weekly status review`;
    }

    hotspots.push({
      zone,
      totalClashes: total,
      newClashes: counts.new || 0,
      persistentClashes: counts.persistent || 0,
      regressionClashes: counts.regression || 0,
      dominantDiscipline,
      riskLevel,
      suggestedAction,
    });
  }

  return hotspots.sort((a, b) => {
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    return riskDiff !== 0 ? riskDiff : b.totalClashes - a.totalClashes;
  });
}

function findDominantDiscipline(delta: DeltaSummary, _zone: string): string {
  const bySev = delta.bySeverity || {};
  let maxDisc = 'Mixed';
  let maxCount = 0;

  for (const [sev, counts] of Object.entries(bySev)) {
    const total = (counts.new || 0) + (counts.persistent || 0);
    if (total > maxCount) {
      maxCount = total;
      maxDisc = sev;
    }
  }

  return maxDisc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ROOT-CAUSE TRENDS
// ═══════════════════════════════════════════════════════════════════════════════

export function analyzeRootCauseTrends(
  deltas: DeltaSummary[],
  issues: IssueRecord[],
): RootCauseTrend[] {
  if (deltas.length < 2) return [];

  const typeByDrop = new Map<string, number[]>();
  const n = deltas.length;

  for (const issue of issues) {
    const rcType = issue.type || 'unknown';
    if (!typeByDrop.has(rcType)) {
      typeByDrop.set(rcType, new Array(n).fill(0));
    }
  }

  let dropIdx = 0;
  for (const _delta of deltas) {
    for (const issue of issues) {
      const rcType = issue.type || 'unknown';
      const arr = typeByDrop.get(rcType);
      if (arr) {
        arr[dropIdx] += 1;
      }
    }
    dropIdx++;
  }

  const trends: RootCauseTrend[] = [];

  for (const [rcType, occurrences] of typeByDrop) {
    if (occurrences.every(v => v === 0)) continue;

    const firstHalf = occurrences.slice(0, Math.ceil(n / 2));
    const secondHalf = occurrences.slice(Math.ceil(n / 2));
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    let trend: RootCauseTrend['trend'] = 'stable';
    if (avgSecond > avgFirst * 1.3) trend = 'increasing';
    else if (avgSecond < avgFirst * 0.7) trend = 'decreasing';

    const isLeadingIndicator = trend === 'increasing' && avgSecond > 3;

    const preventiveActions: Record<string, string> = {
      hard_clash: 'Review 3D coordination model — ensure all disciplines are using latest reference models',
      soft_clash: 'Verify clearance requirements in specifications — update ClearanceRequirements in project settings',
      code_violation: 'Schedule code compliance review session — engage AHJ for interpretation if needed',
      coordination: 'Increase coordination meeting frequency — consider zone-by-zone focused sessions',
      rfi: 'Expedite outstanding RFI responses — escalate aged RFIs to project management',
    };

    trends.push({
      rootCauseType: rcType,
      occurrencesByDrop: occurrences,
      trend,
      isLeadingIndicator,
      preventiveAction: preventiveActions[rcType] || 'Monitor and review in next coordination session',
    });
  }

  return trends.sort((a, b) => {
    if (a.isLeadingIndicator && !b.isLeadingIndicator) return -1;
    if (!a.isLeadingIndicator && b.isLeadingIndicator) return 1;
    const trendOrder: Record<string, number> = { increasing: 0, stable: 1, decreasing: 2 };
    return trendOrder[a.trend] - trendOrder[b.trend];
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

const ALERT_THRESHOLDS = {
  regressionRate: { critical: 0.10, warning: 0.05 },
  netVelocity: { critical: 10, warning: 5 },
  resolutionRate: { critical: 0.2, warning: 0.4 },
};

export function generateAlerts(
  velocity: VelocityMetrics,
  burndowns: BurndownTarget[],
  hotspots: HotspotZone[],
): TrendAlert[] {
  const alerts: TrendAlert[] = [];

  if (velocity.regressionRate >= ALERT_THRESHOLDS.regressionRate.critical) {
    alerts.push({
      level: 'critical',
      message: `Regression rate ${(velocity.regressionRate * 100).toFixed(1)}% exceeds critical threshold — resolved issues are reappearing`,
      metric: 'regressionRate',
      value: velocity.regressionRate,
      threshold: ALERT_THRESHOLDS.regressionRate.critical,
    });
  } else if (velocity.regressionRate >= ALERT_THRESHOLDS.regressionRate.warning) {
    alerts.push({
      level: 'warning',
      message: `Regression rate ${(velocity.regressionRate * 100).toFixed(1)}% approaching threshold — review resolution quality`,
      metric: 'regressionRate',
      value: velocity.regressionRate,
      threshold: ALERT_THRESHOLDS.regressionRate.warning,
    });
  }

  if (velocity.netVelocity >= ALERT_THRESHOLDS.netVelocity.critical) {
    alerts.push({
      level: 'critical',
      message: `Net clash growth ${velocity.netVelocity}/drop — new clashes far outpace resolutions`,
      metric: 'netVelocity',
      value: velocity.netVelocity,
      threshold: ALERT_THRESHOLDS.netVelocity.critical,
    });
  } else if (velocity.netVelocity >= ALERT_THRESHOLDS.netVelocity.warning) {
    alerts.push({
      level: 'warning',
      message: `Net clash growth ${velocity.netVelocity}/drop — resolution rate needs improvement`,
      metric: 'netVelocity',
      value: velocity.netVelocity,
      threshold: ALERT_THRESHOLDS.netVelocity.warning,
    });
  }

  if (velocity.resolutionRate > 0 && velocity.resolutionRate < ALERT_THRESHOLDS.resolutionRate.critical) {
    alerts.push({
      level: 'critical',
      message: `Resolution rate only ${(velocity.resolutionRate * 100).toFixed(1)}% — most clashes persist between drops`,
      metric: 'resolutionRate',
      value: velocity.resolutionRate,
      threshold: ALERT_THRESHOLDS.resolutionRate.critical,
    });
  }

  for (const bd of burndowns) {
    if (!bd.onTrack) {
      alerts.push({
        level: 'warning',
        message: `Milestone "${bd.milestoneName}" (${bd.milestoneDate}) at risk — need ${bd.requiredWeeklyRate} closures/week vs current velocity`,
        metric: 'burndown',
        value: bd.currentOpen,
        threshold: 0,
      });
    }
  }

  const criticalHotspots = hotspots.filter(h => h.riskLevel === 'critical');
  if (criticalHotspots.length > 0) {
    alerts.push({
      level: 'critical',
      message: `${criticalHotspots.length} critical hotspot zone(s): ${criticalHotspots.map(h => h.zone).join(', ')}`,
      metric: 'hotspots',
      value: criticalHotspots.length,
      threshold: 0,
    });
  }

  return alerts.sort((a, b) => {
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return order[a.level] - order[b.level];
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FULL REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function generateTrendReport(
  deltas: DeltaSummary[],
  issues: IssueRecord[],
  milestones: MilestoneDefinition[],
): TrendReport {
  const dataPoints = buildTrendDataPoints(deltas);
  const velocity = calculateVelocity(deltas);

  const openCount = issues.filter(i =>
    !['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(i.status)
  ).length;

  const burndownTargets = calculateBurndown(openCount, velocity, milestones);
  const hotspots = identifyHotspots(deltas);
  const rootCauseTrends = analyzeRootCauseTrends(deltas, issues);
  const alerts = generateAlerts(velocity, burndownTargets, hotspots);

  return {
    generatedDate: new Date().toISOString(),
    dropCount: deltas.length,
    dataPoints,
    velocity,
    burndownTargets,
    hotspots,
    rootCauseTrends,
    alerts,
  };
}
