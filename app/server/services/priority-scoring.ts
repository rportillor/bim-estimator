/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PRIORITY SCORING — SOP Appendix
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Multi-axis priority scoring for BIM coordination issues:
 *    1. Four scoring axes (1-5 each):
 *       a. Life-safety / Code compliance
 *       b. Schedule impact
 *       c. Rework cost
 *       d. Downstream impact
 *    2. Priority = max(LifeSafety, ceil((Schedule + Rework + Downstream) / 3))
 *    3. P1-P2 = CRITICAL, P3 = HIGH, P4 = MEDIUM, P5 = LOW
 *    4. Auto-scoring heuristics from element properties
 *    5. Override capability for manual adjustments
 *
 *  Standards: CIQS, AACE, ISO 19650 risk assessment
 *  Consumed by: issue-log.ts, governance-engine.ts
 *  Depends on:  clash-detection-engine.ts (types)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { ClashSeverity, Discipline, ClashCategory } from './clash-detection-engine';
import type { IssuePriority, PriorityScores } from './issue-log';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScoringInput {
  clashCategory: ClashCategory;
  severity: ClashSeverity;
  disciplineA: Discipline;
  disciplineB: Discipline;
  zone: string;
  codeReferences: string[];
  elementTypes: string[];
  isOnCriticalPath: boolean;
  affectedTradeCount: number;
  estimatedReworkCost: number | null;  // null = unknown → RFI
}

export interface ScoringResult {
  scores: PriorityScores;
  priority: IssuePriority;
  priorityLabel: string;
  reasoning: string[];
  autoScored: boolean;
}

export type PriorityLabel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING CRITERIA DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Life-safety / Code scoring criteria */
const LIFE_SAFETY_RULES: Array<{ condition: (input: ScoringInput) => boolean; score: number; reason: string }> = [
  {
    condition: (i) => i.codeReferences.some(r => /NBC\s*3\.2|NFPA\s*13|fire|egress|sprinkler/i.test(r)),
    score: 5,
    reason: 'Life-safety code reference (fire protection, egress, sprinkler)',
  },
  {
    condition: (i) => i.codeReferences.some(r => /CEC|electrical\s*panel|26-402/i.test(r)),
    score: 5,
    reason: 'Electrical safety code reference (CEC working clearance)',
  },
  {
    condition: (i) => i.clashCategory === 'code_compliance',
    score: 4,
    reason: 'Code compliance clash category',
  },
  {
    condition: (i) => i.disciplineA === 'fire_protection' || i.disciplineB === 'fire_protection',
    score: 4,
    reason: 'Fire protection system involved',
  },
  {
    condition: (i) => i.elementTypes.some(t => /stair|exit|corridor|egress/i.test(t)),
    score: 4,
    reason: 'Egress element involved',
  },
  {
    condition: (i) => i.disciplineA === 'structural' || i.disciplineB === 'structural',
    score: 3,
    reason: 'Structural element involved',
  },
];

/** Schedule impact scoring criteria */
const SCHEDULE_RULES: Array<{ condition: (input: ScoringInput) => boolean; score: number; reason: string }> = [
  {
    condition: (i) => i.isOnCriticalPath,
    score: 5,
    reason: 'Activity on critical path',
  },
  {
    condition: (i) => i.affectedTradeCount >= 4,
    score: 4,
    reason: '4+ trades affected — coordination delay likely',
  },
  {
    condition: (i) => i.affectedTradeCount >= 2,
    score: 3,
    reason: '2-3 trades affected',
  },
  {
    condition: (i) => i.clashCategory === 'hard' && i.severity === 'critical',
    score: 4,
    reason: 'Critical hard clash requires immediate rework',
  },
];

/** Rework cost scoring criteria */
const REWORK_RULES: Array<{ condition: (input: ScoringInput) => boolean; score: number; reason: string }> = [
  {
    condition: (i) => (i.estimatedReworkCost || 0) > 50000,
    score: 5,
    reason: 'Estimated rework cost > $50,000',
  },
  {
    condition: (i) => (i.estimatedReworkCost || 0) > 20000,
    score: 4,
    reason: 'Estimated rework cost > $20,000',
  },
  {
    condition: (i) => (i.estimatedReworkCost || 0) > 5000,
    score: 3,
    reason: 'Estimated rework cost > $5,000',
  },
  {
    condition: (i) => i.disciplineA === 'structural' && i.clashCategory === 'hard',
    score: 4,
    reason: 'Structural rework required (high cost)',
  },
  {
    condition: (i) => i.clashCategory === 'hard',
    score: 3,
    reason: 'Physical rework required',
  },
];

/** Downstream impact scoring criteria */
const DOWNSTREAM_RULES: Array<{ condition: (input: ScoringInput) => boolean; score: number; reason: string }> = [
  {
    condition: (i) => i.affectedTradeCount >= 5,
    score: 5,
    reason: '5+ downstream trades impacted',
  },
  {
    condition: (i) => i.affectedTradeCount >= 3,
    score: 4,
    reason: '3-4 downstream trades impacted',
  },
  {
    condition: (i) => i.elementTypes.some(t => /main|trunk|riser|shaft/i.test(t)),
    score: 4,
    reason: 'Main distribution element — affects all branches',
  },
  {
    condition: (i) => i.affectedTradeCount >= 2,
    score: 3,
    reason: '2 downstream trades impacted',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function evaluateAxis(
  input: ScoringInput,
  rules: Array<{ condition: (i: ScoringInput) => boolean; score: number; reason: string }>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let maxScore = 1; // Minimum score is 1

  for (const rule of rules) {
    if (rule.condition(input)) {
      if (rule.score > maxScore) {
        maxScore = rule.score;
        reasons.length = 0; // Reset to highest reason
      }
      if (rule.score === maxScore) {
        reasons.push(rule.reason);
      }
    }
  }

  return { score: Math.min(5, maxScore), reasons };
}

/**
 * Calculate priority scores from clash/issue properties.
 */
export function calculatePriorityScores(input: ScoringInput): ScoringResult {
  const lifeSafety = evaluateAxis(input, LIFE_SAFETY_RULES);
  const schedule = evaluateAxis(input, SCHEDULE_RULES);
  const rework = evaluateAxis(input, REWORK_RULES);
  const downstream = evaluateAxis(input, DOWNSTREAM_RULES);

  const scores: PriorityScores = {
    lifeSafety: lifeSafety.score,
    scheduleImpact: schedule.score,
    reworkCost: rework.score,
    downstreamImpact: downstream.score,
  };

  const weighted = Math.ceil(
    (scores.scheduleImpact + scores.reworkCost + scores.downstreamImpact) / 3
  );
  const overall = Math.max(scores.lifeSafety, weighted);
  const priorityMap: Record<number, IssuePriority> = { 5: 'P1', 4: 'P2', 3: 'P3', 2: 'P4', 1: 'P5' };
  const priority = priorityMap[Math.min(5, Math.max(1, overall))] || 'P3';

  const reasoning = [
    ...lifeSafety.reasons.map(r => `[Life-safety=${lifeSafety.score}] ${r}`),
    ...schedule.reasons.map(r => `[Schedule=${schedule.score}] ${r}`),
    ...rework.reasons.map(r => `[Rework=${rework.score}] ${r}`),
    ...downstream.reasons.map(r => `[Downstream=${downstream.score}] ${r}`),
  ];

  const labels: Record<IssuePriority, PriorityLabel> = {
    P1: 'CRITICAL', P2: 'CRITICAL', P3: 'HIGH', P4: 'MEDIUM', P5: 'LOW',
  };

  return {
    scores,
    priority,
    priorityLabel: labels[priority],
    reasoning,
    autoScored: true,
  };
}

/**
 * Quick scoring from clash severity (when full analysis not available).
 */
export function quickScoreFromSeverity(severity: ClashSeverity, category: ClashCategory): ScoringResult {
  const severityScoreMap: Record<ClashSeverity, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  };
  const base = severityScoreMap[severity];
  const isCodeRelated = category === 'code_compliance';

  const scores: PriorityScores = {
    lifeSafety: isCodeRelated ? base : Math.max(1, base - 1),
    scheduleImpact: Math.max(1, base - 1),
    reworkCost: category === 'hard' ? base : Math.max(1, base - 1),
    downstreamImpact: Math.max(1, base - 2),
  };

  const weighted = Math.ceil(
    (scores.scheduleImpact + scores.reworkCost + scores.downstreamImpact) / 3
  );
  const overall = Math.max(scores.lifeSafety, weighted);
  const priorityMap: Record<number, IssuePriority> = { 5: 'P1', 4: 'P2', 3: 'P3', 2: 'P4', 1: 'P5' };
  const priority = priorityMap[Math.min(5, Math.max(1, overall))] || 'P3';

  const labels: Record<IssuePriority, PriorityLabel> = {
    P1: 'CRITICAL', P2: 'CRITICAL', P3: 'HIGH', P4: 'MEDIUM', P5: 'LOW',
  };

  return {
    scores,
    priority,
    priorityLabel: labels[priority],
    reasoning: [`Quick score from severity=${severity}, category=${category}`],
    autoScored: true,
  };
}

/**
 * Override a scoring result with manual scores.
 */
export function overrideScores(
  existing: ScoringResult,
  overrides: Partial<PriorityScores>,
  reason: string,
): ScoringResult {
  const scores: PriorityScores = {
    lifeSafety: overrides.lifeSafety ?? existing.scores.lifeSafety,
    scheduleImpact: overrides.scheduleImpact ?? existing.scores.scheduleImpact,
    reworkCost: overrides.reworkCost ?? existing.scores.reworkCost,
    downstreamImpact: overrides.downstreamImpact ?? existing.scores.downstreamImpact,
  };

  const weighted = Math.ceil(
    (scores.scheduleImpact + scores.reworkCost + scores.downstreamImpact) / 3
  );
  const overall = Math.max(scores.lifeSafety, weighted);
  const priorityMap: Record<number, IssuePriority> = { 5: 'P1', 4: 'P2', 3: 'P3', 2: 'P4', 1: 'P5' };
  const priority = priorityMap[Math.min(5, Math.max(1, overall))] || 'P3';

  const labels: Record<IssuePriority, PriorityLabel> = {
    P1: 'CRITICAL', P2: 'CRITICAL', P3: 'HIGH', P4: 'MEDIUM', P5: 'LOW',
  };

  return {
    scores,
    priority,
    priorityLabel: labels[priority],
    reasoning: [...existing.reasoning, `[MANUAL OVERRIDE] ${reason}`],
    autoScored: false,
  };
}
