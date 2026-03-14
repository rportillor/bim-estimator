/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  ISSUE LOG — SOP Part 8
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  20-column issue log per Table 7 of the SOP, with:
 *    1. Naming convention engine: {Level_Zone}-{SystemA_vs_SystemB}-{Grid}-{ShortDesc}
 *    2. 9-state status workflow with valid transitions
 *    3. RFI-ready record generation per Table 8
 *    4. CRUD operations with full audit trail
 *    5. Filtering, sorting, and export support
 *
 *  Status Workflow (Table 9):
 *    OPEN → IN_REVIEW → DECISION_REQUIRED → IN_PROGRESS → READY_FOR_VERIFY → RESOLVED
 *                                                                           → DEFERRED
 *                                                                           → WONT_FIX
 *                                                                           → DUPLICATE
 *
 *  Standards: CIQS Standard Method, ISO 19650, BCF 2.1
 *  Consumed by: bim-coordination-router.ts, bcf-export.ts, governance-engine.ts
 *  Depends on:  dedup-engine.ts (ClashGroup), clash-detection-engine.ts (types)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { randomUUID } from 'crypto';
import type { ClashGroup } from './dedup-engine';
import type { ClashSeverity, Discipline } from './clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. STATUS WORKFLOW (Table 9)
// ═══════════════════════════════════════════════════════════════════════════════

export type IssueStatus =
  | 'OPEN'
  | 'IN_REVIEW'
  | 'DECISION_REQUIRED'
  | 'IN_PROGRESS'
  | 'READY_FOR_VERIFY'
  | 'RESOLVED'
  | 'DEFERRED'
  | 'WONT_FIX'
  | 'DUPLICATE';

/** Valid status transitions per SOP Table 9 */
export const STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  OPEN:               ['IN_REVIEW', 'DUPLICATE'],
  IN_REVIEW:          ['DECISION_REQUIRED', 'IN_PROGRESS', 'WONT_FIX', 'DUPLICATE'],
  DECISION_REQUIRED:  ['IN_PROGRESS', 'DEFERRED', 'WONT_FIX'],
  IN_PROGRESS:        ['READY_FOR_VERIFY', 'DECISION_REQUIRED'],
  READY_FOR_VERIFY:   ['RESOLVED', 'IN_PROGRESS'],   // Resolved ONLY after re-test confirms
  RESOLVED:           [],                              // Terminal
  DEFERRED:           ['OPEN', 'WONT_FIX'],           // Can reopen
  WONT_FIX:           [],                              // Terminal
  DUPLICATE:          [],                              // Terminal
};

export function isValidTransition(from: IssueStatus, to: IssueStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PRIORITY (from Appendix priority scoring)
// ═══════════════════════════════════════════════════════════════════════════════

export type IssuePriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface PriorityScores {
  lifeSafety: number;     // 1-5
  scheduleImpact: number; // 1-5
  reworkCost: number;     // 1-5
  downstreamImpact: number; // 1-5
}

/**
 * Calculate priority per SOP Appendix:
 *   Priority = max(LifeSafety, ceil((Schedule + Rework + Downstream) / 3))
 *   P1 = 5 (Critical), P2 = 4 (High), P3 = 3, P4 = 2, P5 = 1
 */
export function calculatePriority(scores: PriorityScores): IssuePriority {
  const weighted = Math.ceil(
    (scores.scheduleImpact + scores.reworkCost + scores.downstreamImpact) / 3
  );
  const overall = Math.max(scores.lifeSafety, weighted);
  const map: Record<number, IssuePriority> = { 5: 'P1', 4: 'P2', 3: 'P3', 2: 'P4', 1: 'P5' };
  return map[Math.min(5, Math.max(1, overall))] || 'P3';
}

export function priorityFromSeverity(severity: ClashSeverity): IssuePriority {
  const map: Record<ClashSeverity, IssuePriority> = {
    critical: 'P1', high: 'P2', medium: 'P3', low: 'P4', info: 'P5',
  };
  return map[severity];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NAMING CONVENTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate an issue name per SOP convention:
 *   {Level_Zone}-{SystemA_vs_SystemB}-{Grid}-{ShortDesc}
 *   Example: L02_EAST-MECH_vs_STR-C4-DuctBeamConflict
 */
export function generateIssueName(
  level: string,
  zone: string,
  systemA: string,
  systemB: string,
  gridRef: string,
  shortDescription: string,
): string {
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '').toUpperCase();
  const levelPart = sanitize(level || 'L00');
  const zonePart = sanitize(zone || 'GEN');
  const sysAPart = sanitize(systemA).substring(0, 8);
  const sysBPart = sanitize(systemB).substring(0, 8);
  const gridPart = sanitize(gridRef || 'XX');
  const descPart = shortDescription
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .substring(0, 30);

  return `${levelPart}_${zonePart}-${sysAPart}_vs_${sysBPart}-${gridPart}-${descPart}`;
}

/** Map discipline to system abbreviation for naming */
function disciplineToSystem(discipline: Discipline): string {
  const map: Record<Discipline, string> = {
    structural: 'STR',
    architectural: 'ARC',
    mechanical: 'MECH',
    electrical: 'ELEC',
    plumbing: 'PLBG',
    fire_protection: 'FP',
    site: 'SITE',
    other: 'OTHER',
  };
  return map[discipline] || 'OTHER';
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 20-COLUMN ISSUE RECORD (Table 7)
// ═══════════════════════════════════════════════════════════════════════════════

export interface IssueRecord {
  // ── Core Identity (Cols 1-4) ─────────────────────────────────────────────
  id: string;                        // Col 1: Unique ID (UUID)
  issueNumber: string;               // Col 2: Sequential number (ISS-0001)
  name: string;                      // Col 3: Generated per naming convention
  testId: string;                    // Col 4: Clash test template ID (CD-001, SC-01, etc.)

  // ── Classification (Cols 5-8) ───────────────────────────────────────────
  type: 'hard_clash' | 'soft_clash' | 'code_violation' | 'coordination' | 'rfi';  // Col 5
  zone: string;                      // Col 6: Level_Zone
  gridRef: string;                   // Col 7: Nearest grid intersection
  priority: IssuePriority;           // Col 8: P1-P5

  // ── Ownership (Cols 9-11) ───────────────────────────────────────────────
  owner: string;                     // Col 9: Responsible discipline lead
  assignedTo: string;                // Col 10: Specific assignee
  originDiscipline: Discipline;      // Col 11: Discipline that created the issue

  // ── Status & Dates (Cols 12-15) ─────────────────────────────────────────
  status: IssueStatus;               // Col 12
  createdDate: string;               // Col 13: ISO date
  targetDate: string;                // Col 14: Resolution target
  resolvedDate: string | null;       // Col 15: Actual resolution date

  // ── Description (Cols 16-18) ────────────────────────────────────────────
  description: string;               // Col 16: Full description
  recommendation: string;            // Col 17: Suggested resolution
  resolution: string | null;         // Col 18: Actual resolution applied

  // ── References (Cols 19-20) ─────────────────────────────────────────────
  clashGroupId: string | null;       // Col 19: Link to ClashGroup
  rfiNumber: string | null;          // Col 20: Associated RFI number

  // ── Metadata (not in Table 7 but required for traceability) ─────────────
  priorityScores: PriorityScores | null;
  elementIds: string[];              // All affected element IDs
  codeReferences: string[];
  statusHistory: StatusTransition[];
  attachments: string[];             // File paths / BCF viewpoint refs
  tags: string[];                    // Free-form tags for filtering
}

export interface StatusTransition {
  from: IssueStatus;
  to: IssueStatus;
  date: string;
  user: string;
  comment: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RFI-READY RECORD (Table 8)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RFIRecord {
  rfiNumber: string;
  issueId: string;
  subject: string;
  discipline: Discipline;
  toParty: string;                   // Design team / consultant
  fromParty: string;                 // Contractor / BIM coordinator
  dateIssued: string;
  dateRequired: string;
  description: string;
  backgroundContext: string;
  questionItems: string[];
  suggestedAction: string;
  codeReferences: string[];
  attachedIssueIds: string[];
  attachedClashGroupIds: string[];
  status: 'draft' | 'issued' | 'responded' | 'closed';
  responseDate: string | null;
  responseText: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. ISSUE LOG MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

export class IssueLogManager {
  private issues: Map<string, IssueRecord> = new Map();
  private rfis: Map<string, RFIRecord> = new Map();
  private issueCounter = 0;
  private rfiCounter = 0;

  /** Get all issues */
  getAll(): IssueRecord[] {
    return Array.from(this.issues.values());
  }

  /** Get issue by ID */
  getById(id: string): IssueRecord | undefined {
    return this.issues.get(id);
  }

  /** Get issues by filter */
  filter(criteria: Partial<{
    status: IssueStatus | IssueStatus[];
    priority: IssuePriority | IssuePriority[];
    zone: string;
    discipline: Discipline;
    owner: string;
    testId: string;
    clashGroupId: string;
  }>): IssueRecord[] {
    let results = this.getAll();

    if (criteria.status) {
      const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status];
      results = results.filter(i => statuses.includes(i.status));
    }
    if (criteria.priority) {
      const priorities = Array.isArray(criteria.priority) ? criteria.priority : [criteria.priority];
      results = results.filter(i => priorities.includes(i.priority));
    }
    if (criteria.zone) results = results.filter(i => i.zone === criteria.zone);
    if (criteria.discipline) results = results.filter(i => i.originDiscipline === criteria.discipline);
    if (criteria.owner) results = results.filter(i => i.owner === criteria.owner);
    if (criteria.testId) results = results.filter(i => i.testId === criteria.testId);
    if (criteria.clashGroupId) results = results.filter(i => i.clashGroupId === criteria.clashGroupId);

    return results;
  }

  /**
   * Create an issue from a ClashGroup (primary creation path).
   */
  createFromClashGroup(
    group: ClashGroup,
    options: {
      owner?: string;
      assignedTo?: string;
      targetDays?: number;
    } = {},
  ): IssueRecord {
    this.issueCounter++;
    const now = new Date().toISOString();
    const targetDays = options.targetDays || this.defaultTargetDays(group.highestSeverity);
    const targetDate = new Date(Date.now() + targetDays * 86400000).toISOString();

    const affectedDisc = group.affectedDisciplines.filter(d => d !== group.rootCauseDiscipline);
    const systemA = disciplineToSystem(group.rootCauseDiscipline);
    const systemB = affectedDisc.length > 0 ? disciplineToSystem(affectedDisc[0]) : 'MULTI';

    const primaryClash = group.clashes[0];
    const type = this.classifyIssueType(primaryClash);

    const name = generateIssueName(
      group.zone,
      '',
      systemA,
      systemB,
      group.gridRef,
      group.rootCauseType.replace(/[^A-Za-z0-9 ]/g, '').substring(0, 20),
    );

    const issue: IssueRecord = {
      id: randomUUID(),
      issueNumber: `ISS-${String(this.issueCounter).padStart(4, '0')}`,
      name,
      testId: primaryClash?.testId || 'MANUAL',
      type,
      zone: group.zone,
      gridRef: group.gridRef,
      priority: priorityFromSeverity(group.highestSeverity),
      owner: options.owner || this.defaultOwner(group.rootCauseDiscipline),
      assignedTo: options.assignedTo || '',
      originDiscipline: group.rootCauseDiscipline,
      status: 'OPEN',
      createdDate: now,
      targetDate,
      resolvedDate: null,
      description: group.description,
      recommendation: group.suggestedAction,
      resolution: null,
      clashGroupId: group.groupId,
      rfiNumber: null,
      priorityScores: null,
      elementIds: [group.rootCauseElementId, ...group.affectedElements],
      codeReferences: [...new Set(group.clashes.flatMap(c => c.codeReferences))],
      statusHistory: [{
        from: 'OPEN',
        to: 'OPEN',
        date: now,
        user: 'system',
        comment: 'Issue created from clash detection run',
      }],
      attachments: [],
      tags: [group.rootCauseDiscipline, group.zone, `severity:${group.highestSeverity}`],
    };

    this.issues.set(issue.id, issue);
    return issue;
  }

  /**
   * Create an issue manually (not from clash group).
   */
  createManual(input: {
    name?: string;
    type: IssueRecord['type'];
    zone: string;
    gridRef: string;
    priority: IssuePriority;
    priorityScores?: PriorityScores;
    owner: string;
    assignedTo?: string;
    originDiscipline: Discipline;
    description: string;
    recommendation: string;
    targetDays?: number;
    codeReferences?: string[];
    elementIds?: string[];
    tags?: string[];
  }): IssueRecord {
    this.issueCounter++;
    const now = new Date().toISOString();
    const targetDays = input.targetDays || this.defaultTargetDays(
      input.priority === 'P1' ? 'critical' : input.priority === 'P2' ? 'high' : 'medium'
    );

    const priority = input.priorityScores
      ? calculatePriority(input.priorityScores)
      : input.priority;

    const issue: IssueRecord = {
      id: randomUUID(),
      issueNumber: `ISS-${String(this.issueCounter).padStart(4, '0')}`,
      name: input.name || `MANUAL-${input.zone}-${input.gridRef}`,
      testId: 'MANUAL',
      type: input.type,
      zone: input.zone,
      gridRef: input.gridRef,
      priority,
      owner: input.owner,
      assignedTo: input.assignedTo || '',
      originDiscipline: input.originDiscipline,
      status: 'OPEN',
      createdDate: now,
      targetDate: new Date(Date.now() + targetDays * 86400000).toISOString(),
      resolvedDate: null,
      description: input.description,
      recommendation: input.recommendation,
      resolution: null,
      clashGroupId: null,
      rfiNumber: null,
      priorityScores: input.priorityScores || null,
      elementIds: input.elementIds || [],
      codeReferences: input.codeReferences || [],
      statusHistory: [{
        from: 'OPEN',
        to: 'OPEN',
        date: now,
        user: 'system',
        comment: 'Issue created manually',
      }],
      attachments: [],
      tags: input.tags || [],
    };

    this.issues.set(issue.id, issue);
    return issue;
  }

  /**
   * Update issue status with workflow enforcement.
   */
  updateStatus(
    issueId: string,
    newStatus: IssueStatus,
    user: string,
    comment: string,
  ): { success: boolean; error?: string; issue?: IssueRecord } {
    const issue = this.issues.get(issueId);
    if (!issue) return { success: false, error: `Issue ${issueId} not found` };

    if (!isValidTransition(issue.status, newStatus)) {
      return {
        success: false,
        error: `Invalid transition: ${issue.status} → ${newStatus}. Valid targets: ${STATUS_TRANSITIONS[issue.status].join(', ') || 'none (terminal)'}`,
      };
    }

    const transition: StatusTransition = {
      from: issue.status,
      to: newStatus,
      date: new Date().toISOString(),
      user,
      comment,
    };

    issue.statusHistory.push(transition);
    issue.status = newStatus;

    if (newStatus === 'RESOLVED') {
      issue.resolvedDate = new Date().toISOString();
    }

    return { success: true, issue };
  }

  /**
   * Update issue fields (non-status).
   */
  updateFields(
    issueId: string,
    updates: Partial<Pick<IssueRecord, 'owner' | 'assignedTo' | 'priority' | 'targetDate' | 'recommendation' | 'resolution' | 'tags' | 'attachments'>>,
  ): IssueRecord | null {
    const issue = this.issues.get(issueId);
    if (!issue) return null;

    if (updates.owner !== undefined) issue.owner = updates.owner;
    if (updates.assignedTo !== undefined) issue.assignedTo = updates.assignedTo;
    if (updates.priority !== undefined) issue.priority = updates.priority;
    if (updates.targetDate !== undefined) issue.targetDate = updates.targetDate;
    if (updates.recommendation !== undefined) issue.recommendation = updates.recommendation;
    if (updates.resolution !== undefined) issue.resolution = updates.resolution;
    if (updates.tags !== undefined) issue.tags = updates.tags;
    if (updates.attachments !== undefined) issue.attachments = updates.attachments;

    return issue;
  }

  /**
   * Generate an RFI from an issue.
   */
  generateRFI(
    issueId: string,
    toParty: string,
    fromParty: string,
    additionalQuestions: string[] = [],
  ): RFIRecord | null {
    const issue = this.issues.get(issueId);
    if (!issue) return null;

    this.rfiCounter++;
    const rfiNumber = `RFI-${String(this.rfiCounter).padStart(4, '0')}`;

    const rfi: RFIRecord = {
      rfiNumber,
      issueId: issue.id,
      subject: `${issue.name} — Resolution Required`,
      discipline: issue.originDiscipline,
      toParty,
      fromParty,
      dateIssued: new Date().toISOString(),
      dateRequired: issue.targetDate,
      description: issue.description,
      backgroundContext: `This RFI originates from clash detection issue ${issue.issueNumber} (${issue.name}). ` +
        `Priority: ${issue.priority}. Zone: ${issue.zone}. Grid: ${issue.gridRef}.`,
      questionItems: [
        `Please provide resolution for: ${issue.description}`,
        ...issue.codeReferences.map(ref => `Please confirm compliance with ${ref}`),
        ...additionalQuestions,
      ],
      suggestedAction: issue.recommendation,
      codeReferences: issue.codeReferences,
      attachedIssueIds: [issue.id],
      attachedClashGroupIds: issue.clashGroupId ? [issue.clashGroupId] : [],
      status: 'draft',
      responseDate: null,
      responseText: null,
    };

    this.rfis.set(rfi.rfiNumber, rfi);
    issue.rfiNumber = rfiNumber;

    return rfi;
  }

  /** Get all RFIs */
  getAllRFIs(): RFIRecord[] {
    return Array.from(this.rfis.values());
  }

  /** Get summary statistics */
  getSummary(): {
    total: number;
    byStatus: Record<IssueStatus, number>;
    byPriority: Record<IssuePriority, number>;
    byDiscipline: Record<string, number>;
    overdue: number;
    rfisIssued: number;
  } {
    const issues = this.getAll();
    const now = Date.now();

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byDiscipline: Record<string, number> = {};
    let overdue = 0;

    for (const issue of issues) {
      byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
      byPriority[issue.priority] = (byPriority[issue.priority] || 0) + 1;
      byDiscipline[issue.originDiscipline] = (byDiscipline[issue.originDiscipline] || 0) + 1;

      if (!['RESOLVED', 'WONT_FIX', 'DUPLICATE'].includes(issue.status)) {
        if (new Date(issue.targetDate).getTime() < now) overdue++;
      }
    }

    return {
      total: issues.length,
      byStatus: byStatus as Record<IssueStatus, number>,
      byPriority: byPriority as Record<IssuePriority, number>,
      byDiscipline: byDiscipline as Record<string, number>,
      overdue,
      rfisIssued: this.rfis.size,
    };
  }

  /**
   * Batch-create issues from all clash groups in a dedup result.
   */
  createFromClashGroups(
    groups: ClashGroup[],
    options?: { owner?: string; targetDays?: number },
  ): IssueRecord[] {
    return groups.map(g => this.createFromClashGroup(g, options));
  }

  /** Export all issues as flat rows for CSV/Excel */
  exportFlat(): Array<Record<string, string | number | null>> {
    return this.getAll().map(issue => ({
      issueNumber: issue.issueNumber,
      name: issue.name,
      testId: issue.testId,
      type: issue.type,
      zone: issue.zone,
      gridRef: issue.gridRef,
      priority: issue.priority,
      owner: issue.owner,
      assignedTo: issue.assignedTo,
      originDiscipline: issue.originDiscipline,
      status: issue.status,
      createdDate: issue.createdDate,
      targetDate: issue.targetDate,
      resolvedDate: issue.resolvedDate,
      description: issue.description,
      recommendation: issue.recommendation,
      resolution: issue.resolution,
      clashGroupId: issue.clashGroupId,
      rfiNumber: issue.rfiNumber,
      elementCount: issue.elementIds.length,
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private classifyIssueType(clash: any): IssueRecord['type'] {
    if (!clash) return 'coordination';
    if (clash.category === 'hard') return 'hard_clash';
    if (clash.category === 'soft' || clash.category === 'tolerance') return 'soft_clash';
    if (clash.category === 'code_compliance') return 'code_violation';
    return 'coordination';
  }

  private defaultOwner(discipline: Discipline): string {
    const map: Record<Discipline, string> = {
      structural: 'Structural Lead',
      architectural: 'Architectural Lead',
      mechanical: 'Mechanical Lead',
      electrical: 'Electrical Lead',
      plumbing: 'Plumbing Lead',
      fire_protection: 'FP Lead',
      site: 'Site Lead',
      other: 'BIM Coordinator',
    };
    return map[discipline] || 'BIM Coordinator';
  }

  private defaultTargetDays(severity: ClashSeverity): number {
    // SLA from SOP Part 13: P1-P2 = 10 working days, P3 = 15, P4-P5 = 20
    const map: Record<ClashSeverity, number> = {
      critical: 10, high: 10, medium: 15, low: 20, info: 30,
    };
    return map[severity] || 15;
  }
}
