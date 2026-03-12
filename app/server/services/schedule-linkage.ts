/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SCHEDULE LINKAGE — SOP Part 11
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Links BIM coordination issues to P6/project schedule:
 *    1. Map clash groups → WBS codes / activity IDs
 *    2. Float consumption analysis (total float consumed by unresolved clashes)
 *    3. Critical path integration (CP_RISK / NEAR_CP / BUFFERED classification)
 *    4. Activity-to-model element mapping matrix
 *    5. Long-lead procurement flag
 *
 *  Standards: AACE 18R-97 (Schedule Development), P6 integration, CIQS
 *  Consumed by: milestone-protection.ts, governance-engine.ts, bim-coordination-router.ts
 *  Depends on:  issue-log.ts, dedup-engine.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { IssueRecord, IssuePriority } from './issue-log';
import type { ClashGroup } from './dedup-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PathClassification = 'CP_RISK' | 'NEAR_CP' | 'BUFFERED';

export interface ScheduleActivity {
  activityId: string;              // P6 Activity ID (e.g. A1020)
  wbsCode: string;                 // WBS code (e.g. 1.3.2)
  name: string;
  discipline: string;
  zone: string;                    // Level/zone
  plannedStart: string;            // ISO date
  plannedFinish: string;
  actualStart: string | null;
  actualFinish: string | null;
  totalFloat: number;              // Working days
  freeFloat: number;
  isCritical: boolean;             // Total float ≤ 0
  predecessors: string[];          // Activity IDs
  successors: string[];
  elementIds: string[];            // BIM element IDs linked to this activity
  resourceIds: string[];
  longLead: boolean;               // True if procurement lead > 8 weeks
  longLeadItem: string | null;     // Description of long-lead item
}

export interface ActivityIssueLink {
  activityId: string;
  issueId: string;
  issueNumber: string;
  issuePriority: IssuePriority;
  linkType: 'direct' | 'zone_match' | 'discipline_match' | 'element_match';
  confidence: number;              // 0.0-1.0
  floatImpact: number;             // Estimated float consumed (working days)
  pathClassification: PathClassification;
}

export interface FloatAnalysis {
  activityId: string;
  activityName: string;
  originalFloat: number;           // From schedule
  consumedByClashes: number;       // Estimated days consumed
  remainingFloat: number;
  pathClassification: PathClassification;
  linkedIssues: string[];          // Issue numbers
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
}

export interface ScheduleLinkageResult {
  totalActivities: number;
  linkedActivities: number;
  unlinkedActivities: number;
  links: ActivityIssueLink[];
  floatAnalysis: FloatAnalysis[];
  criticalPathIssues: ActivityIssueLink[];
  longLeadItems: Array<{ activityId: string; item: string; linkedIssueCount: number }>;
  summary: {
    activitiesAtRisk: number;
    criticalPathImpacted: boolean;
    totalFloatConsumed: number;
    byPathClassification: Record<PathClassification, number>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLOAT THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════════

/** Near-critical threshold (working days) */
const NEAR_CP_THRESHOLD = 5;

/** Default delay estimate per unresolved issue (working days) by priority */
const DELAY_ESTIMATE: Record<IssuePriority, number> = {
  P1: 10,
  P2: 5,
  P3: 3,
  P4: 1,
  P5: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// LINKAGE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Link issues to schedule activities.
 *
 * Matching strategy (in priority order):
 *   1. Element match: issue elementIds ∩ activity elementIds
 *   2. Direct zone+discipline match
 *   3. Zone-only match
 *   4. Discipline-only match
 */
export function linkIssuesToSchedule(
  issues: IssueRecord[],
  activities: ScheduleActivity[],
): ScheduleLinkageResult {
  const links: ActivityIssueLink[] = [];
  const linkedActivityIds = new Set<string>();

  // Index activities by zone and discipline for fast lookup
  const actByZone = new Map<string, ScheduleActivity[]>();
  const actByDisc = new Map<string, ScheduleActivity[]>();
  const actByElement = new Map<string, ScheduleActivity[]>();

  for (const act of activities) {
    // By zone
    const zoneKey = act.zone.toUpperCase();
    if (!actByZone.has(zoneKey)) actByZone.set(zoneKey, []);
    actByZone.get(zoneKey)!.push(act);

    // By discipline
    const discKey = act.discipline.toUpperCase();
    if (!actByDisc.has(discKey)) actByDisc.set(discKey, []);
    actByDisc.get(discKey)!.push(act);

    // By element
    for (const elId of act.elementIds) {
      if (!actByElement.has(elId)) actByElement.set(elId, []);
      actByElement.get(elId)!.push(act);
    }
  }

  const openIssues = issues.filter(i =>
    !['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(i.status)
  );

  for (const issue of openIssues) {
    const matchedActivities = new Set<string>();

    // Strategy 1: Element match (highest confidence)
    for (const elId of issue.elementIds) {
      const matched = actByElement.get(elId) || [];
      for (const act of matched) {
        if (!matchedActivities.has(act.activityId)) {
          matchedActivities.add(act.activityId);
          links.push(buildLink(act, issue, 'element_match', 0.95));
          linkedActivityIds.add(act.activityId);
        }
      }
    }

    // Strategy 2: Zone + discipline match
    const issueZone = issue.zone.toUpperCase();
    const issueDisc = issue.originDiscipline.toUpperCase();
    const zoneActs = actByZone.get(issueZone) || [];

    for (const act of zoneActs) {
      if (matchedActivities.has(act.activityId)) continue;
      if (act.discipline.toUpperCase() === issueDisc) {
        matchedActivities.add(act.activityId);
        links.push(buildLink(act, issue, 'zone_match', 0.75));
        linkedActivityIds.add(act.activityId);
      }
    }

    // Strategy 3: Zone-only (lower confidence)
    if (matchedActivities.size === 0) {
      for (const act of zoneActs.slice(0, 3)) {
        if (!matchedActivities.has(act.activityId)) {
          matchedActivities.add(act.activityId);
          links.push(buildLink(act, issue, 'zone_match', 0.5));
          linkedActivityIds.add(act.activityId);
        }
      }
    }

    // Strategy 4: Discipline-only (lowest confidence)
    if (matchedActivities.size === 0) {
      const discActs = actByDisc.get(issueDisc) || [];
      for (const act of discActs.slice(0, 2)) {
        if (!matchedActivities.has(act.activityId)) {
          matchedActivities.add(act.activityId);
          links.push(buildLink(act, issue, 'discipline_match', 0.35));
          linkedActivityIds.add(act.activityId);
        }
      }
    }
  }

  // Float analysis
  const floatAnalysis = computeFloatAnalysis(activities, links);

  // Critical path issues
  const criticalPathIssues = links.filter(l => l.pathClassification === 'CP_RISK');

  // Long-lead items
  const longLeadItems = activities
    .filter(a => a.longLead && a.longLeadItem)
    .map(a => ({
      activityId: a.activityId,
      item: a.longLeadItem!,
      linkedIssueCount: links.filter(l => l.activityId === a.activityId).length,
    }));

  // Summary
  const byPath: Record<PathClassification, number> = { CP_RISK: 0, NEAR_CP: 0, BUFFERED: 0 };
  for (const fa of floatAnalysis) byPath[fa.pathClassification]++;

  return {
    totalActivities: activities.length,
    linkedActivities: linkedActivityIds.size,
    unlinkedActivities: activities.length - linkedActivityIds.size,
    links,
    floatAnalysis,
    criticalPathIssues,
    longLeadItems,
    summary: {
      activitiesAtRisk: floatAnalysis.filter(f => f.riskLevel === 'critical' || f.riskLevel === 'high').length,
      criticalPathImpacted: criticalPathIssues.length > 0,
      totalFloatConsumed: floatAnalysis.reduce((sum, f) => sum + f.consumedByClashes, 0),
      byPathClassification: byPath,
    },
  };
}

function buildLink(
  activity: ScheduleActivity,
  issue: IssueRecord,
  linkType: ActivityIssueLink['linkType'],
  confidence: number,
): ActivityIssueLink {
  const floatImpact = DELAY_ESTIMATE[issue.priority] || 0;
  const pathClass = classifyPath(activity.totalFloat, floatImpact);

  return {
    activityId: activity.activityId,
    issueId: issue.id,
    issueNumber: issue.issueNumber,
    issuePriority: issue.priority,
    linkType,
    confidence,
    floatImpact,
    pathClassification: pathClass,
  };
}

function classifyPath(totalFloat: number, consumedFloat: number): PathClassification {
  const remaining = totalFloat - consumedFloat;
  if (remaining <= 0) return 'CP_RISK';
  if (remaining <= NEAR_CP_THRESHOLD) return 'NEAR_CP';
  return 'BUFFERED';
}

function computeFloatAnalysis(
  activities: ScheduleActivity[],
  links: ActivityIssueLink[],
): FloatAnalysis[] {
  const linksByActivity = new Map<string, ActivityIssueLink[]>();
  for (const link of links) {
    if (!linksByActivity.has(link.activityId)) linksByActivity.set(link.activityId, []);
    linksByActivity.get(link.activityId)!.push(link);
  }

  const results: FloatAnalysis[] = [];

  for (const [actId, actLinks] of linksByActivity) {
    const activity = activities.find(a => a.activityId === actId);
    if (!activity) continue;

    const consumed = actLinks.reduce((sum, l) => sum + l.floatImpact, 0);
    const remaining = Math.max(0, activity.totalFloat - consumed);
    const pathClass = classifyPath(activity.totalFloat, consumed);

    const riskLevel =
      pathClass === 'CP_RISK' ? 'critical' :
      pathClass === 'NEAR_CP' ? 'high' :
      consumed > 0 ? 'medium' : 'low';

    results.push({
      activityId: actId,
      activityName: activity.name,
      originalFloat: activity.totalFloat,
      consumedByClashes: consumed,
      remainingFloat: remaining,
      pathClassification: pathClass,
      linkedIssues: actLinks.map(l => l.issueNumber),
      riskLevel,
    });
  }

  return results.sort((a, b) => a.remainingFloat - b.remainingFloat);
}
