/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  GOVERNANCE ENGINE — SOP Part 13
 *  EstimatorPro v14.35 — Project-agnostic; projectName must be passed by caller
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Weekly BIM coordination governance:
 *    1. Cadence management: T-48h model drop cutoff, T-36h clash run, T-24h pack
 *    2. SLA tracking: response times by priority tier
 *    3. Meeting pack generator: agenda, status, actions, risks
 *    4. Closure verification: confirm resolution in model before closing issue
 *    5. Escalation triggers: overdue items, regression alerts
 *
 *  Standards: ISO 19650, CIQS, project BEP
 *  Consumed by: bim-coordination-router.ts
 *  Depends on:  issue-log.ts, delta-tracker.ts, trend-analytics.ts,
 *               milestone-protection.ts, penetrations-matrix.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { IssueRecord, IssuePriority, IssueStatus } from './issue-log';
import type { DeltaSummary } from './delta-tracker';
import type { TrendReport, TrendAlert } from './trend-analytics';
import type { MilestoneProtectionReport } from './milestone-protection';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type CadencePhase = 'MODEL_DROP' | 'CLASH_RUN' | 'PACK_PREP' | 'MEETING' | 'ACTION_PERIOD';

export interface WeeklyCadence {
  meetingDay: number;              // 0=Sun … 4=Thu, 5=Fri
  meetingTime: string;             // 'HH:MM' 24h
  modelDropCutoff_h: number;       // Hours before meeting (default 48)
  clashRunCutoff_h: number;        // Hours before meeting (default 36)
  packPrepCutoff_h: number;        // Hours before meeting (default 24)
}

export interface SLADefinition {
  priority: IssuePriority;
  initialResponse_h: number;       // Hours to first response
  resolutionTarget_days: number;   // Working days to resolution
  escalationAfter_days: number;    // Working days before escalation
}

export interface SLAStatus {
  issueId: string;
  issueNumber: string;
  priority: IssuePriority;
  owner: string;
  createdDate: string;
  ageInDays: number;
  targetDays: number;
  daysRemaining: number;
  percentElapsed: number;
  slaStatus: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  escalationRequired: boolean;
}

export interface MeetingAgendaItem {
  order: number;
  topic: string;
  presenter: string;
  duration_min: number;
  description: string;
  attachedIssueIds: string[];
}

export interface MeetingPack {
  meetingDate: string;
  meetingNumber: number;
  projectName: string;
  agenda: MeetingAgendaItem[];
  statusSummary: {
    totalOpen: number;
    newSinceLastMeeting: number;
    resolvedSinceLastMeeting: number;
    overdue: number;
    regressions: number;
  };
  slaOverview: {
    onTrack: number;
    atRisk: number;
    breached: number;
    items: SLAStatus[];
  };
  topRisks: Array<{
    issueNumber: string;
    name: string;
    priority: IssuePriority;
    zone: string;
    owner: string;
    daysRemaining: number;
  }>;
  milestoneAlerts: string[];
  trendAlerts: TrendAlert[];
  actionItems: ActionItem[];
  previousActionStatus: ActionItem[];
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  status: 'OPEN' | 'COMPLETE' | 'CARRIED_OVER';
  meetingNumber: number;
  relatedIssueId: string | null;
}

export interface ClosureVerification {
  issueId: string;
  issueNumber: string;
  verificationDate: string;
  modelDropId: string;
  clashStillPresent: boolean;
  verificationPassed: boolean;
  notes: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_CADENCE: WeeklyCadence = {
  meetingDay: 3,                   // Wednesday
  meetingTime: '10:00',
  modelDropCutoff_h: 48,          // Monday 10:00
  clashRunCutoff_h: 36,           // Monday 22:00
  packPrepCutoff_h: 24,           // Tuesday 10:00
};

export const DEFAULT_SLAS: SLADefinition[] = [
  { priority: 'P1', initialResponse_h: 4, resolutionTarget_days: 10, escalationAfter_days: 5 },
  { priority: 'P2', initialResponse_h: 8, resolutionTarget_days: 10, escalationAfter_days: 7 },
  { priority: 'P3', initialResponse_h: 24, resolutionTarget_days: 15, escalationAfter_days: 10 },
  { priority: 'P4', initialResponse_h: 48, resolutionTarget_days: 20, escalationAfter_days: 15 },
  { priority: 'P5', initialResponse_h: 72, resolutionTarget_days: 30, escalationAfter_days: 25 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CADENCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

export function getCurrentPhase(cadence: WeeklyCadence = DEFAULT_CADENCE): {
  phase: CadencePhase;
  nextDeadline: string;
  hoursUntilDeadline: number;
} {
  const now = new Date();
  const meetingDate = getNextMeetingDate(cadence);
  const meetingMs = meetingDate.getTime();

  const dropCutoff = new Date(meetingMs - cadence.modelDropCutoff_h * 3600000);
  const clashCutoff = new Date(meetingMs - cadence.clashRunCutoff_h * 3600000);
  const packCutoff = new Date(meetingMs - cadence.packPrepCutoff_h * 3600000);

  if (now < dropCutoff) {
    const hours = (dropCutoff.getTime() - now.getTime()) / 3600000;
    return { phase: 'MODEL_DROP', nextDeadline: dropCutoff.toISOString(), hoursUntilDeadline: Math.round(hours * 10) / 10 };
  }
  if (now < clashCutoff) {
    const hours = (clashCutoff.getTime() - now.getTime()) / 3600000;
    return { phase: 'CLASH_RUN', nextDeadline: clashCutoff.toISOString(), hoursUntilDeadline: Math.round(hours * 10) / 10 };
  }
  if (now < packCutoff) {
    const hours = (packCutoff.getTime() - now.getTime()) / 3600000;
    return { phase: 'PACK_PREP', nextDeadline: packCutoff.toISOString(), hoursUntilDeadline: Math.round(hours * 10) / 10 };
  }
  if (now < meetingDate) {
    const hours = (meetingMs - now.getTime()) / 3600000;
    return { phase: 'MEETING', nextDeadline: meetingDate.toISOString(), hoursUntilDeadline: Math.round(hours * 10) / 10 };
  }

  // After meeting — action period until next cycle
  const nextDrop = new Date(meetingMs + (7 * 24 - cadence.modelDropCutoff_h) * 3600000);
  const hours = (nextDrop.getTime() - now.getTime()) / 3600000;
  return { phase: 'ACTION_PERIOD', nextDeadline: nextDrop.toISOString(), hoursUntilDeadline: Math.round(hours * 10) / 10 };
}

function getNextMeetingDate(cadence: WeeklyCadence): Date {
  const now = new Date();
  const [h, m] = cadence.meetingTime.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);

  const currentDay = now.getDay();
  let daysUntil = cadence.meetingDay - currentDay;
  if (daysUntil < 0 || (daysUntil === 0 && now > target)) daysUntil += 7;
  target.setDate(target.getDate() + daysUntil);

  return target;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. SLA TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

export function trackSLAs(
  issues: IssueRecord[],
  slas: SLADefinition[] = DEFAULT_SLAS,
): SLAStatus[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const terminalStatuses: IssueStatus[] = ['RESOLVED', 'WONT_FIX', 'DUPLICATE'];

  const openIssues = issues.filter(i => !terminalStatuses.includes(i.status));
  const slaMap = new Map<IssuePriority, SLADefinition>();
  for (const sla of slas) slaMap.set(sla.priority, sla);

  return openIssues.map(issue => {
    const sla = slaMap.get(issue.priority) || slas[2]; // Default P3
    const createdMs = new Date(issue.createdDate).getTime();
    const ageMs = now - createdMs;
    const ageDays = Math.round(ageMs / dayMs);
    const daysRemaining = sla.resolutionTarget_days - ageDays;
    const percentElapsed = Math.round((ageDays / sla.resolutionTarget_days) * 100);

    let slaStatus: SLAStatus['slaStatus'] = 'ON_TRACK';
    if (ageDays > sla.resolutionTarget_days) slaStatus = 'BREACHED';
    else if (ageDays > sla.escalationAfter_days) slaStatus = 'AT_RISK';

    return {
      issueId: issue.id,
      issueNumber: issue.issueNumber,
      priority: issue.priority,
      owner: issue.owner,
      createdDate: issue.createdDate,
      ageInDays: ageDays,
      targetDays: sla.resolutionTarget_days,
      daysRemaining: Math.max(0, daysRemaining),
      percentElapsed: Math.min(100, percentElapsed),
      slaStatus,
      escalationRequired: slaStatus === 'BREACHED' || (slaStatus === 'AT_RISK' && issue.priority <= 'P2'),
    };
  }).sort((a, b) => {
    const statusOrder: Record<string, number> = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2 };
    const statusDiff = statusOrder[a.slaStatus] - statusOrder[b.slaStatus];
    return statusDiff !== 0 ? statusDiff : a.daysRemaining - b.daysRemaining;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MEETING PACK GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

export function generateMeetingPack(
  meetingNumber: number,
  issues: IssueRecord[],
  latestDelta: DeltaSummary | null,
  trendReport: TrendReport | null,
  milestoneReport: MilestoneProtectionReport | null,
  previousActions: ActionItem[] = [],
  projectName: string = '',
): MeetingPack {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const terminalStatuses: IssueStatus[] = ['RESOLVED', 'WONT_FIX', 'DUPLICATE'];

  const openIssues = issues.filter(i => !terminalStatuses.includes(i.status));
  const newIssues = issues.filter(i => new Date(i.createdDate) > weekAgo);
  const resolvedIssues = issues.filter(i =>
    i.status === 'RESOLVED' && i.resolvedDate && new Date(i.resolvedDate) > weekAgo
  );
  const overdueIssues = openIssues.filter(i => new Date(i.targetDate) < now);

  const slaItems = trackSLAs(issues);

  // Build agenda
  const agenda: MeetingAgendaItem[] = [
    {
      order: 1, topic: 'Review Previous Actions', presenter: 'BIM Coordinator',
      duration_min: 5, description: 'Status of action items from previous meeting',
      attachedIssueIds: [],
    },
    {
      order: 2, topic: 'Model Drop Status', presenter: 'BIM Coordinator',
      duration_min: 5, description: 'Which disciplines dropped models, gating results',
      attachedIssueIds: [],
    },
    {
      order: 3, topic: 'Clash Detection Results', presenter: 'BIM Coordinator',
      duration_min: 10, description: `Delta: ${latestDelta?.newCount || 0} new, ${latestDelta?.resolvedCount || 0} resolved, ${latestDelta?.regressionCount || 0} regressions`,
      attachedIssueIds: [],
    },
    {
      order: 4, topic: 'Critical / High Priority Issues', presenter: 'Discipline Leads',
      duration_min: 15, description: `${openIssues.filter(i => i.priority <= 'P2').length} P1-P2 issues open`,
      attachedIssueIds: openIssues.filter(i => i.priority <= 'P2').map(i => i.id),
    },
    {
      order: 5, topic: 'SLA / Overdue Review', presenter: 'BIM Coordinator',
      duration_min: 5, description: `${slaItems.filter(s => s.slaStatus === 'BREACHED').length} breached, ${overdueIssues.length} overdue`,
      attachedIssueIds: overdueIssues.map(i => i.id),
    },
    {
      order: 6, topic: 'Milestone Risk Assessment', presenter: 'Scheduler',
      duration_min: 5, description: milestoneReport?.summary || 'No milestone data available',
      attachedIssueIds: [],
    },
    {
      order: 7, topic: 'New Action Items', presenter: 'All',
      duration_min: 10, description: 'Assign new actions for resolution',
      attachedIssueIds: [],
    },
  ];

  // Top risks
  const topRisks = openIssues
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .slice(0, 10)
    .map(i => ({
      issueNumber: i.issueNumber,
      name: i.name,
      priority: i.priority,
      zone: i.zone,
      owner: i.owner,
      daysRemaining: Math.max(0, Math.round((new Date(i.targetDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))),
    }));

  // Milestone alerts
  const milestoneAlerts = milestoneReport?.immediateActions || [];

  // Trend alerts
  const trendAlerts = trendReport?.alerts || [];

  // Generate new action items from critical issues
  const actionItems: ActionItem[] = overdueIssues.slice(0, 5).map((issue, idx) => ({
    id: `AI-${meetingNumber}-${String(idx + 1).padStart(2, '0')}`,
    description: `Resolve overdue issue ${issue.issueNumber}: ${issue.name}`,
    owner: issue.owner,
    dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10),
    status: 'OPEN' as const,
    meetingNumber,
    relatedIssueId: issue.id,
  }));

  // Update previous action statuses
  const updatedPreviousActions = previousActions.map(a => {
    if (a.relatedIssueId) {
      const issue = issues.find(i => i.id === a.relatedIssueId);
      if (issue && terminalStatuses.includes(issue.status)) {
        return { ...a, status: 'COMPLETE' as const };
      }
    }
    if (a.status === 'OPEN' && new Date(a.dueDate) < now) {
      return { ...a, status: 'CARRIED_OVER' as const };
    }
    return a;
  });

  return {
    meetingDate: now.toISOString().substring(0, 10),
    meetingNumber,
    projectName,
    agenda,
    statusSummary: {
      totalOpen: openIssues.length,
      newSinceLastMeeting: newIssues.length,
      resolvedSinceLastMeeting: resolvedIssues.length,
      overdue: overdueIssues.length,
      regressions: latestDelta?.regressionCount || 0,
    },
    slaOverview: {
      onTrack: slaItems.filter(s => s.slaStatus === 'ON_TRACK').length,
      atRisk: slaItems.filter(s => s.slaStatus === 'AT_RISK').length,
      breached: slaItems.filter(s => s.slaStatus === 'BREACHED').length,
      items: slaItems,
    },
    topRisks,
    milestoneAlerts,
    trendAlerts,
    actionItems,
    previousActionStatus: updatedPreviousActions,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CLOSURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Verify that a resolved issue is actually fixed in the latest model drop.
 * If the clash still exists in the new run, the issue should be reopened.
 */
export function verifyClosures(
  resolvedIssues: IssueRecord[],
  latestDelta: DeltaSummary,
): ClosureVerification[] {
  return resolvedIssues.map(issue => {
    const isRegression = latestDelta.regressions.some(r =>
      r.description.toLowerCase().includes(issue.name.toLowerCase().substring(0, 20))
    );

    return {
      issueId: issue.id,
      issueNumber: issue.issueNumber,
      verificationDate: new Date().toISOString(),
      modelDropId: latestDelta.runId,
      clashStillPresent: isRegression,
      verificationPassed: !isRegression,
      notes: isRegression
        ? `FAILED: Clash reappeared in drop ${latestDelta.runId} — reopen issue and investigate root cause`
        : `PASSED: Clash not present in drop ${latestDelta.runId} — closure confirmed`,
    };
  });
}
