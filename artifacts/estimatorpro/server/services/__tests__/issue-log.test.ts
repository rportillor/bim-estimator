/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  ISSUE LOG — Test Suite (SOP Part 8)
 *  Tests: status transitions, naming, priority scoring, RFI generation,
 *         IssueLogManager CRUD, filtering, summary
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  isValidTransition,
  calculatePriority,
  priorityFromSeverity,
  generateIssueName,
  IssueLogManager,
  STATUS_TRANSITIONS,
} from '../issue-log';

import type {
  IssueStatus,
  IssuePriority,
  PriorityScores,
} from '../issue-log';

import type { ClashGroup } from '../dedup-engine';

// ── Mock crypto.randomUUID so IDs are deterministic ────────────────────────
jest.mock('crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `uuid-${++counter}`,
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS — build test fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makeClashGroup(overrides: Partial<ClashGroup> = {}): ClashGroup {
  return {
    groupId: 'grp-001',
    rootCauseElementId: 'beam-001',
    rootCauseElementName: 'W12x26 Beam',
    rootCauseDiscipline: 'structural',
    rootCauseType: 'Beam Duct Conflict',
    zone: 'L02_EAST',
    gridRef: 'C4',
    highestSeverity: 'critical',
    clashCount: 2,
    clashes: [
      {
        id: 'clash-1',
        testId: 'CD-001',
        category: 'hard',
        severity: 'critical',
        codeReferences: ['IBC 2021 Table 716.1'],
      } as any,
    ],
    affectedDisciplines: ['structural', 'mechanical'],
    affectedElements: ['duct-001'],
    description: 'Beam penetrates supply duct at Level 2 East wing',
    suggestedAction: 'Reroute duct below beam soffit',
    ...overrides,
  };
}

function makeManualIssueInput(overrides: Partial<Parameters<IssueLogManager['createManual']>[0]> = {}) {
  return {
    type: 'coordination' as const,
    zone: 'L02_EAST',
    gridRef: 'C4',
    priority: 'P2' as IssuePriority,
    owner: 'Structural Lead',
    originDiscipline: 'structural' as const,
    description: 'Beam clearance issue',
    recommendation: 'Reroute duct',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATUS TRANSITIONS (9-state workflow)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Status Transitions', () => {
  test('OPEN can transition to IN_REVIEW', () => {
    expect(isValidTransition('OPEN', 'IN_REVIEW')).toBe(true);
  });

  test('OPEN can transition to DUPLICATE', () => {
    expect(isValidTransition('OPEN', 'DUPLICATE')).toBe(true);
  });

  test('OPEN cannot transition directly to RESOLVED', () => {
    expect(isValidTransition('OPEN', 'RESOLVED')).toBe(false);
  });

  test('IN_REVIEW can transition to DECISION_REQUIRED, IN_PROGRESS, WONT_FIX, DUPLICATE', () => {
    expect(isValidTransition('IN_REVIEW', 'DECISION_REQUIRED')).toBe(true);
    expect(isValidTransition('IN_REVIEW', 'IN_PROGRESS')).toBe(true);
    expect(isValidTransition('IN_REVIEW', 'WONT_FIX')).toBe(true);
    expect(isValidTransition('IN_REVIEW', 'DUPLICATE')).toBe(true);
  });

  test('RESOLVED is terminal — no outbound transitions', () => {
    expect(STATUS_TRANSITIONS['RESOLVED']).toEqual([]);
    expect(isValidTransition('RESOLVED', 'OPEN')).toBe(false);
  });

  test('WONT_FIX is terminal', () => {
    expect(STATUS_TRANSITIONS['WONT_FIX']).toEqual([]);
  });

  test('DUPLICATE is terminal', () => {
    expect(STATUS_TRANSITIONS['DUPLICATE']).toEqual([]);
  });

  test('DEFERRED can transition back to OPEN', () => {
    expect(isValidTransition('DEFERRED', 'OPEN')).toBe(true);
  });

  test('DEFERRED can transition to WONT_FIX', () => {
    expect(isValidTransition('DEFERRED', 'WONT_FIX')).toBe(true);
  });

  test('READY_FOR_VERIFY can reach RESOLVED or loop back to IN_PROGRESS', () => {
    expect(isValidTransition('READY_FOR_VERIFY', 'RESOLVED')).toBe(true);
    expect(isValidTransition('READY_FOR_VERIFY', 'IN_PROGRESS')).toBe(true);
  });

  test('all statuses in the workflow have defined transitions', () => {
    const statuses: IssueStatus[] = [
      'OPEN', 'IN_REVIEW', 'DECISION_REQUIRED', 'IN_PROGRESS',
      'READY_FOR_VERIFY', 'RESOLVED', 'DEFERRED', 'WONT_FIX', 'DUPLICATE',
    ];
    for (const s of statuses) {
      expect(STATUS_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(STATUS_TRANSITIONS[s])).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PRIORITY SCORING
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculatePriority', () => {
  test('max life-safety score produces P1', () => {
    const scores: PriorityScores = {
      lifeSafety: 5,
      scheduleImpact: 1,
      reworkCost: 1,
      downstreamImpact: 1,
    };
    expect(calculatePriority(scores)).toBe('P1');
  });

  test('all-1 scores produce P5', () => {
    const scores: PriorityScores = {
      lifeSafety: 1,
      scheduleImpact: 1,
      reworkCost: 1,
      downstreamImpact: 1,
    };
    expect(calculatePriority(scores)).toBe('P5');
  });

  test('high weighted average elevates priority even with low lifeSafety', () => {
    const scores: PriorityScores = {
      lifeSafety: 1,
      scheduleImpact: 5,
      reworkCost: 5,
      downstreamImpact: 5,
    };
    // weighted = ceil((5+5+5)/3) = 5, overall = max(1,5) = 5 => P1
    expect(calculatePriority(scores)).toBe('P1');
  });

  test('moderate scores produce P3', () => {
    const scores: PriorityScores = {
      lifeSafety: 3,
      scheduleImpact: 3,
      reworkCost: 3,
      downstreamImpact: 3,
    };
    // weighted = ceil(9/3) = 3, overall = max(3,3) = 3 => P3
    expect(calculatePriority(scores)).toBe('P3');
  });

  test('lifeSafety dominates when higher than weighted', () => {
    const scores: PriorityScores = {
      lifeSafety: 4,
      scheduleImpact: 1,
      reworkCost: 1,
      downstreamImpact: 1,
    };
    // weighted = ceil(3/3) = 1, overall = max(4,1) = 4 => P2
    expect(calculatePriority(scores)).toBe('P2');
  });
});

describe('priorityFromSeverity', () => {
  test('critical severity maps to P1', () => {
    expect(priorityFromSeverity('critical')).toBe('P1');
  });

  test('high severity maps to P2', () => {
    expect(priorityFromSeverity('high')).toBe('P2');
  });

  test('medium severity maps to P3', () => {
    expect(priorityFromSeverity('medium')).toBe('P3');
  });

  test('low severity maps to P4', () => {
    expect(priorityFromSeverity('low')).toBe('P4');
  });

  test('info severity maps to P5', () => {
    expect(priorityFromSeverity('info')).toBe('P5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  NAMING CONVENTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateIssueName', () => {
  test('generates name in {Level_Zone}-{SysA_vs_SysB}-{Grid}-{Desc} format', () => {
    const name = generateIssueName('L02', 'EAST', 'MECH', 'STR', 'C4', 'Duct Beam Conflict');
    expect(name).toBe('L02_EAST-MECH_vs_STR-C4-DuctBeamConflict');
  });

  test('sanitises special characters', () => {
    const name = generateIssueName('L-02', 'East!', 'Me/ch', 'St@r', 'C.4', 'hello world');
    // Special chars stripped, uppercased
    expect(name).toMatch(/^L02_EAST-/);
    expect(name).not.toMatch(/[!@./]/);
  });

  test('includes system abbreviations in name', () => {
    const name = generateIssueName('L01', 'ZONE', 'VERYLONGSYSTEM', 'ANOTHER_LONG', 'A1', 'Test');
    expect(name).toContain('VERYLONG');
    expect(name).toContain('ANOTHER');
  });

  test('different disciplines produce different names', () => {
    const nameA = generateIssueName('L02', 'EAST', 'MECH', 'STR', 'C4', 'Conflict');
    const nameB = generateIssueName('L02', 'EAST', 'ELEC', 'STR', 'C4', 'Conflict');
    expect(nameA).not.toBe(nameB);
  });

  test('uses defaults for empty level/zone/grid', () => {
    const name = generateIssueName('', '', 'SYS_A', 'SYS_B', '', 'Desc');
    expect(name).toMatch(/^L00_GEN-/);
    expect(name).toContain('-XX-');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ISSUE LOG MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

describe('IssueLogManager', () => {
  let manager: IssueLogManager;

  beforeEach(() => {
    manager = new IssueLogManager();
  });

  // ── createManual ──────────────────────────────────────────────────────────

  test('createManual creates an issue with status OPEN', () => {
    const issue = manager.createManual(makeManualIssueInput());
    expect(issue).toBeDefined();
    expect(issue.status).toBe('OPEN');
    expect(issue.issueNumber).toBe('ISS-0001');
  });

  test('createManual uses priorityScores when provided', () => {
    const issue = manager.createManual(makeManualIssueInput({
      priority: 'P5',
      priorityScores: { lifeSafety: 5, scheduleImpact: 5, reworkCost: 5, downstreamImpact: 5 },
    }));
    // calculatePriority overrides the explicit priority
    expect(issue.priority).toBe('P1');
  });

  test('createManual assigns sequential issue numbers', () => {
    const i1 = manager.createManual(makeManualIssueInput());
    const i2 = manager.createManual(makeManualIssueInput({ zone: 'L03_WEST' }));
    expect(i1.issueNumber).toBe('ISS-0001');
    expect(i2.issueNumber).toBe('ISS-0002');
  });

  // ── createFromClashGroup ──────────────────────────────────────────────────

  test('createFromClashGroup creates issue linked to the clash group', () => {
    const group = makeClashGroup();
    const issue = manager.createFromClashGroup(group);
    expect(issue.clashGroupId).toBe('grp-001');
    expect(issue.status).toBe('OPEN');
    expect(issue.priority).toBe('P1'); // critical => P1
    expect(issue.elementIds).toContain('beam-001');
    expect(issue.elementIds).toContain('duct-001');
  });

  test('createFromClashGroup respects owner override', () => {
    const group = makeClashGroup();
    const issue = manager.createFromClashGroup(group, { owner: 'Custom Owner' });
    expect(issue.owner).toBe('Custom Owner');
  });

  // ── updateStatus (workflow enforcement) ───────────────────────────────────

  test('updateStatus transitions OPEN -> IN_REVIEW', () => {
    const issue = manager.createManual(makeManualIssueInput());
    const result = manager.updateStatus(issue.id, 'IN_REVIEW', 'tester', 'Starting review');
    expect(result.success).toBe(true);
    expect(result.issue?.status).toBe('IN_REVIEW');
  });

  test('updateStatus rejects invalid transition', () => {
    const issue = manager.createManual(makeManualIssueInput());
    // OPEN -> RESOLVED is not valid
    const result = manager.updateStatus(issue.id, 'RESOLVED', 'tester', 'Skip');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('updateStatus returns error for non-existent issue', () => {
    const result = manager.updateStatus('no-such-id', 'IN_REVIEW', 'tester', 'test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('updateStatus sets resolvedDate when transitioning to RESOLVED', () => {
    const issue = manager.createManual(makeManualIssueInput());
    // Walk through: OPEN -> IN_REVIEW -> IN_PROGRESS -> READY_FOR_VERIFY -> RESOLVED
    manager.updateStatus(issue.id, 'IN_REVIEW', 'u', 'c');
    manager.updateStatus(issue.id, 'IN_PROGRESS', 'u', 'c');
    manager.updateStatus(issue.id, 'READY_FOR_VERIFY', 'u', 'c');
    const result = manager.updateStatus(issue.id, 'RESOLVED', 'u', 'Done');
    expect(result.success).toBe(true);
    expect(result.issue?.resolvedDate).not.toBeNull();
  });

  test('updateStatus builds status history', () => {
    const issue = manager.createManual(makeManualIssueInput());
    manager.updateStatus(issue.id, 'IN_REVIEW', 'alice', 'review');
    manager.updateStatus(issue.id, 'IN_PROGRESS', 'bob', 'working');
    const updated = manager.getById(issue.id);
    // 1 initial + 2 transitions = 3
    expect(updated?.statusHistory).toHaveLength(3);
    expect(updated?.statusHistory[1].user).toBe('alice');
    expect(updated?.statusHistory[2].from).toBe('IN_REVIEW');
    expect(updated?.statusHistory[2].to).toBe('IN_PROGRESS');
  });

  // ── updateFields ──────────────────────────────────────────────────────────

  test('updateFields updates owner and assignedTo', () => {
    const issue = manager.createManual(makeManualIssueInput());
    const updated = manager.updateFields(issue.id, { owner: 'New Owner', assignedTo: 'Jane' });
    expect(updated?.owner).toBe('New Owner');
    expect(updated?.assignedTo).toBe('Jane');
  });

  test('updateFields returns null for missing issue', () => {
    expect(manager.updateFields('nope', { owner: 'X' })).toBeNull();
  });

  // ── getAll / getById / filter ─────────────────────────────────────────────

  test('getAll returns all issues', () => {
    manager.createManual(makeManualIssueInput());
    manager.createManual(makeManualIssueInput({ zone: 'L03_WEST' }));
    manager.createManual(makeManualIssueInput({ zone: 'L04_NORTH' }));
    expect(manager.getAll()).toHaveLength(3);
  });

  test('getById retrieves the correct issue', () => {
    const issue = manager.createManual(makeManualIssueInput());
    expect(manager.getById(issue.id)).toBe(issue);
  });

  test('getById returns undefined for unknown id', () => {
    expect(manager.getById('unknown')).toBeUndefined();
  });

  test('filter by status', () => {
    const i1 = manager.createManual(makeManualIssueInput());
    manager.createManual(makeManualIssueInput());
    manager.updateStatus(i1.id, 'IN_REVIEW', 'u', 'c');

    const inReview = manager.filter({ status: 'IN_REVIEW' });
    expect(inReview).toHaveLength(1);
    expect(inReview[0].id).toBe(i1.id);
  });

  test('filter by priority', () => {
    manager.createManual(makeManualIssueInput({ priority: 'P1' }));
    manager.createManual(makeManualIssueInput({ priority: 'P4' }));

    const p1 = manager.filter({ priority: 'P1' });
    expect(p1).toHaveLength(1);
    expect(p1[0].priority).toBe('P1');
  });

  test('filter by discipline', () => {
    manager.createManual(makeManualIssueInput({ originDiscipline: 'structural' }));
    manager.createManual(makeManualIssueInput({ originDiscipline: 'structural' }));
    manager.createManual(makeManualIssueInput({ originDiscipline: 'mechanical' }));

    const structural = manager.filter({ discipline: 'structural' });
    expect(structural).toHaveLength(2);
  });

  test('filter by multiple statuses (array)', () => {
    const i1 = manager.createManual(makeManualIssueInput());
    manager.createManual(makeManualIssueInput());
    manager.updateStatus(i1.id, 'IN_REVIEW', 'u', 'c');
    // second issue stays OPEN

    const results = manager.filter({ status: ['OPEN', 'IN_REVIEW'] });
    expect(results).toHaveLength(2);
  });

  // ── generateRFI ───────────────────────────────────────────────────────────

  test('generateRFI creates an RFI linked to the issue', () => {
    const issue = manager.createManual(makeManualIssueInput({
      codeReferences: ['IBC 2021 Table 716.1'],
    }));

    const rfi = manager.generateRFI(issue.id, 'Design Team', 'BIM Coordinator');
    expect(rfi).not.toBeNull();
    expect(rfi!.rfiNumber).toMatch(/^RFI-/);
    expect(rfi!.issueId).toBe(issue.id);
    expect(rfi!.toParty).toBe('Design Team');
    expect(rfi!.fromParty).toBe('BIM Coordinator');
    expect(rfi!.status).toBe('draft');

    // Issue should now reference the RFI
    const updated = manager.getById(issue.id);
    expect(updated?.rfiNumber).toBe(rfi!.rfiNumber);
  });

  test('generateRFI returns null for non-existent issue', () => {
    expect(manager.generateRFI('bad-id', 'A', 'B')).toBeNull();
  });

  test('generateRFI includes code references in questions', () => {
    const issue = manager.createManual(makeManualIssueInput({
      codeReferences: ['NEC 110.26', 'IBC 716.1'],
    }));
    const rfi = manager.generateRFI(issue.id, 'Design', 'Contractor');
    expect(rfi!.questionItems.length).toBeGreaterThanOrEqual(3); // 1 base + 2 code refs
    expect(rfi!.codeReferences).toEqual(['NEC 110.26', 'IBC 716.1']);
  });

  test('getAllRFIs returns all generated RFIs', () => {
    const i1 = manager.createManual(makeManualIssueInput());
    const i2 = manager.createManual(makeManualIssueInput());
    manager.generateRFI(i1.id, 'A', 'B');
    manager.generateRFI(i2.id, 'C', 'D');
    expect(manager.getAllRFIs()).toHaveLength(2);
  });

  // ── getSummary ────────────────────────────────────────────────────────────

  test('getSummary returns correct counts', () => {
    manager.createManual(makeManualIssueInput({ priority: 'P1', originDiscipline: 'structural' }));
    manager.createManual(makeManualIssueInput({ priority: 'P4', originDiscipline: 'mechanical' }));

    const summary = manager.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.byStatus['OPEN']).toBe(2);
    expect(summary.byPriority['P1']).toBe(1);
    expect(summary.byPriority['P4']).toBe(1);
    expect(summary.byDiscipline['structural']).toBe(1);
    expect(summary.byDiscipline['mechanical']).toBe(1);
  });

  test('getSummary counts RFIs', () => {
    const issue = manager.createManual(makeManualIssueInput());
    manager.generateRFI(issue.id, 'A', 'B');
    expect(manager.getSummary().rfisIssued).toBe(1);
  });

  // ── exportFlat ────────────────────────────────────────────────────────────

  test('exportFlat returns flat row objects', () => {
    manager.createManual(makeManualIssueInput());
    const rows = manager.exportFlat();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('issueNumber');
    expect(rows[0]).toHaveProperty('status', 'OPEN');
    expect(rows[0]).toHaveProperty('elementCount');
  });

  // ── createFromClashGroups (batch) ─────────────────────────────────────────

  test('createFromClashGroups batch-creates issues', () => {
    const groups = [
      makeClashGroup({ groupId: 'g1' }),
      makeClashGroup({ groupId: 'g2', highestSeverity: 'low' }),
    ];
    const issues = manager.createFromClashGroups(groups);
    expect(issues).toHaveLength(2);
    expect(issues[0].clashGroupId).toBe('g1');
    expect(issues[1].clashGroupId).toBe('g2');
    expect(issues[1].priority).toBe('P4'); // low => P4
  });
});
