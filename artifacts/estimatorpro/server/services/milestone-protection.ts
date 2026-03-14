/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MILESTONE PROTECTION — SOP Part 11
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Protects project milestones from clash-induced delays:
 *    1. Decision date calculation (latest date to resolve before milestone impact)
 *    2. Delay exposure ranges (best/expected/worst case)
 *    3. Risk-to-path classification (CP_RISK/NEAR_CP/BUFFERED)
 *    4. Recovery actions engine (workface split, night shift, prefab change)
 *    5. Escalation triggers for PM/Owner notification
 *
 *  Standards: AACE RP 52R-06, CIQS, P6 best practices
 *  Consumed by: governance-engine.ts, bim-coordination-router.ts
 *  Depends on:  schedule-linkage.ts, issue-log.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { ScheduleLinkageResult } from './schedule-linkage';
import type { IssueRecord, IssuePriority } from './issue-log';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProjectMilestone {
  id: string;
  name: string;
  date: string;
  type: 'contractual' | 'internal' | 'regulatory' | 'handover';
  linkedActivityIds: string[];
  criticality: 'must_hit' | 'target' | 'aspirational';
}

export interface MilestoneRisk {
  milestoneId: string;
  milestoneName: string;
  milestoneDate: string;
  criticality: ProjectMilestone['criticality'];
  decisionDate: string;           // Last date to make a decision
  daysUntilDecision: number;
  delayExposure: {
    bestCase: number;              // Working days
    expectedCase: number;
    worstCase: number;
  };
  affectedIssues: string[];        // Issue IDs
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  recoveryActions: RecoveryAction[];
  escalationRequired: boolean;
  escalationReason: string | null;
}

export interface RecoveryAction {
  id: string;
  type: 'workface_split' | 'night_shift' | 'prefab_change' | 'resequence' | 'add_resources' | 'design_change' | 'accept_risk';
  description: string;
  costImpact: 'none' | 'low' | 'medium' | 'high';
  scheduleRecovery: number;        // Working days recovered
  feasibility: 'high' | 'medium' | 'low';
  requiresApproval: string;        // Who must approve
}

export interface MilestoneProtectionReport {
  generatedDate: string;
  milestones: MilestoneRisk[];
  criticalCount: number;
  highCount: number;
  immediateActions: string[];
  summary: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DECISION DATE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

const _WORKING_DAYS_PER_WEEK = 5;

function addWorkingDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  const direction = days >= 0 ? 1 : -1;
  const absDays = Math.abs(days);

  while (added < absDays) {
    result.setDate(result.getDate() + direction);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * Calculate the latest decision date for a milestone.
 * Decision date = milestone date - (estimated resolution time + buffer)
 */
function calculateDecisionDate(
  milestoneDate: string,
  estimatedResolutionDays: number,
  bufferDays: number = 5,
): { decisionDate: Date; daysUntil: number } {
  const msDate = new Date(milestoneDate);
  const totalLeadTime = estimatedResolutionDays + bufferDays;
  const decisionDate = addWorkingDays(msDate, -totalLeadTime);
  const daysUntil = workingDaysBetween(new Date(), decisionDate);

  return { decisionDate, daysUntil };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DELAY EXPOSURE ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════

function estimateDelayExposure(
  issues: IssueRecord[],
): { bestCase: number; expectedCase: number; worstCase: number } {
  if (issues.length === 0) return { bestCase: 0, expectedCase: 0, worstCase: 0 };

  const delayByPriority: Record<IssuePriority, { best: number; expected: number; worst: number }> = {
    P1: { best: 3, expected: 5, worst: 10 },
    P2: { best: 2, expected: 3, worst: 7 },
    P3: { best: 1, expected: 2, worst: 4 },
    P4: { best: 0.5, expected: 1, worst: 2 },
    P5: { best: 0, expected: 0.5, worst: 1 },
  };

  let best = 0, expected = 0, worst = 0;

  for (const issue of issues) {
    if (['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(issue.status)) continue;
    const delays = delayByPriority[issue.priority] || delayByPriority.P3;
    best += delays.best;
    expected += delays.expected;
    worst += delays.worst;
  }

  // Parallel resolution factor (not all issues are sequential)
  const parallelFactor = Math.max(0.3, 1 / Math.sqrt(issues.length));

  return {
    bestCase: Math.round(best * parallelFactor * 10) / 10,
    expectedCase: Math.round(expected * parallelFactor * 10) / 10,
    worstCase: Math.round(worst * parallelFactor * 10) / 10,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RECOVERY ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function generateRecoveryActions(
  delayExposure: number,
  affectedDisciplines: string[],
): RecoveryAction[] {
  const actions: RecoveryAction[] = [];
  let actionIdx = 1;

  if (delayExposure >= 5) {
    actions.push({
      id: `RA-${String(actionIdx++).padStart(3, '0')}`,
      type: 'workface_split',
      description: 'Split affected zone into sub-workfaces — allow parallel resolution by multiple trades',
      costImpact: 'low',
      scheduleRecovery: Math.round(delayExposure * 0.3),
      feasibility: 'high',
      requiresApproval: 'Construction Manager',
    });
  }

  if (delayExposure >= 3) {
    actions.push({
      id: `RA-${String(actionIdx++).padStart(3, '0')}`,
      type: 'night_shift',
      description: 'Add night shift for clash resolution activities (rework, rerouting)',
      costImpact: 'high',
      scheduleRecovery: Math.round(delayExposure * 0.5),
      feasibility: 'medium',
      requiresApproval: 'Project Manager + Owner',
    });
  }

  if (affectedDisciplines.some(d => ['mechanical', 'plumbing', 'electrical'].includes(d))) {
    actions.push({
      id: `RA-${String(actionIdx++).padStart(3, '0')}`,
      type: 'prefab_change',
      description: 'Convert field-routed MEP to prefabricated assemblies — reduces on-site coordination',
      costImpact: 'medium',
      scheduleRecovery: Math.round(delayExposure * 0.4),
      feasibility: 'medium',
      requiresApproval: 'MEP Coordinator + Procurement',
    });
  }

  if (delayExposure >= 2) {
    actions.push({
      id: `RA-${String(actionIdx++).padStart(3, '0')}`,
      type: 'resequence',
      description: 'Resequence activities to work around unresolved clashes — defer affected areas',
      costImpact: 'low',
      scheduleRecovery: Math.round(delayExposure * 0.6),
      feasibility: 'high',
      requiresApproval: 'Scheduler + Construction Manager',
    });
  }

  actions.push({
    id: `RA-${String(actionIdx++).padStart(3, '0')}`,
    type: 'add_resources',
    description: 'Add dedicated BIM coordinator / clash resolution resources',
    costImpact: 'medium',
    scheduleRecovery: Math.round(delayExposure * 0.2),
    feasibility: 'high',
    requiresApproval: 'Project Manager',
  });

  if (delayExposure >= 7) {
    actions.push({
      id: `RA-${String(actionIdx++).padStart(3, '0')}`,
      type: 'design_change',
      description: 'Request design change to eliminate root cause (e.g. raise ceiling, relocate shaft)',
      costImpact: 'high',
      scheduleRecovery: Math.round(delayExposure * 0.7),
      feasibility: 'low',
      requiresApproval: 'Design Team Lead + Owner',
    });
  }

  actions.push({
    id: `RA-${String(actionIdx++).padStart(3, '0')}`,
    type: 'accept_risk',
    description: 'Accept remaining schedule risk — document in risk register with contingency allowance',
    costImpact: 'none',
    scheduleRecovery: 0,
    feasibility: 'high',
    requiresApproval: 'Project Manager',
  });

  return actions;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MAIN PROTECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export function assessMilestoneProtection(
  milestones: ProjectMilestone[],
  issues: IssueRecord[],
  linkageResult: ScheduleLinkageResult,
): MilestoneProtectionReport {
  const risks: MilestoneRisk[] = [];

  for (const ms of milestones) {
    // Find issues linked to this milestone's activities
    const linkedLinks = linkageResult.links.filter(
      l => ms.linkedActivityIds.includes(l.activityId)
    );
    const linkedIssueIds = [...new Set(linkedLinks.map(l => l.issueId).filter(Boolean))] as string[];

    const linkedIssues = issues.filter(i => linkedIssueIds.includes(i.id));
    const openIssues = linkedIssues.filter(i =>
      !['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(i.status)
    );

    const delayExposure = estimateDelayExposure(openIssues);
    const { decisionDate, daysUntil } = calculateDecisionDate(
      ms.date,
      delayExposure.expectedCase,
    );

    let riskLevel: MilestoneRisk['riskLevel'] = 'low';
    if (daysUntil <= 0 && openIssues.length > 0) riskLevel = 'critical';
    else if (daysUntil <= 5 && openIssues.length > 0) riskLevel = 'high';
    else if (daysUntil <= 15 && openIssues.length > 0) riskLevel = 'medium';

    const affectedDiscs = [...new Set(openIssues.map(i => i.originDiscipline))];
    const recoveryActions = generateRecoveryActions(delayExposure.expectedCase, affectedDiscs);

    const escalationRequired = riskLevel === 'critical' ||
      (riskLevel === 'high' && ms.criticality === 'must_hit');
    const escalationReason = escalationRequired
      ? `Milestone "${ms.name}" at ${riskLevel} risk with ${daysUntil} working days until decision deadline. ` +
        `${openIssues.length} open issue(s), ${delayExposure.expectedCase} days expected exposure.`
      : null;

    risks.push({
      milestoneId: ms.id,
      milestoneName: ms.name,
      milestoneDate: ms.date,
      criticality: ms.criticality,
      decisionDate: decisionDate.toISOString().substring(0, 10),
      daysUntilDecision: daysUntil,
      delayExposure,
      affectedIssues: linkedIssueIds,
      riskLevel,
      recoveryActions,
      escalationRequired,
      escalationReason,
    });
  }

  risks.sort((a, b) => {
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
  });

  const criticalCount = risks.filter(r => r.riskLevel === 'critical').length;
  const highCount = risks.filter(r => r.riskLevel === 'high').length;

  const immediateActions: string[] = [];
  for (const r of risks.filter(r => r.escalationRequired)) {
    immediateActions.push(
      `ESCALATE: ${r.milestoneName} — decision required by ${r.decisionDate} (${r.daysUntilDecision} working days)`
    );
  }

  return {
    generatedDate: new Date().toISOString(),
    milestones: risks,
    criticalCount,
    highCount,
    immediateActions,
    summary: `${milestones.length} milestones assessed: ${criticalCount} critical, ${highCount} high risk. ` +
      `${immediateActions.length} immediate escalation(s) required.`,
  };
}
