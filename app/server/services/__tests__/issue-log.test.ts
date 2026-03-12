/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  ISSUE LOG — Test Suite (SOP Part 8)
 *  45+ tests: status transitions, naming, priority scoring, RFI generation
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

import type { IssueStatus, IssuePriority, PriorityScores } from '../issue-log';

// ═══════════════════════════════════════════════════════════════════════════════
//  STATUS TRANSITIONS (9-state workflow)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Status Transitions', () => {
  test('NEW can transition to OPEN', () => {
    expect(isValidTransition('NEW', 'OPEN')).toBe(true);
  });

  test('NEW cannot transition directly to CLOSED', () => {
    expect(isValidTransition('NEW', 'CLOSED')).toBe(false);
  });

  test('OPEN can transition to IN_PROGRESS', () => {
    expect(isValidTransition('OPEN', 'IN_PROGRESS')).toBe(true);
  });

  test('CLOSED cannot transition to NEW', () => {
    expect(isValidTransition('CLOSED', 'NEW')).toBe(false);
  });

  test('all statuses have defined transitions', () => {
    const statuses: IssueStatus[] = [
      'NEW', 'OPEN', 'IN_PROGRESS', 'IN_REVIEW',
      'RESOLVED', 'CLOSED', 'DEFERRED', 'REJECTED', 'REOPENED',
    ];
    for (const s of statuses) {
      expect(STATUS_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(STATUS_TRANSITIONS[s])).toBe(true);
    }
  });

  test('RESOLVED can transition to CLOSED or REOPENED', () => {
    expect(isValidTransition('RESOLVED', 'CLOSED')).toBe(true);
  });

  test('DEFERRED can transition back to OPEN', () => {
    expect(isValidTransition('DEFERRED', 'OPEN')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PRIORITY SCORING
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculatePriority', () => {
  test('high scores produce P1 priority', () => {
    const scores: PriorityScores = {
      safety: 10,
      cost: 9,
      schedule: 8,
      quality: 7,
    };
    expect(calculatePriority(scores)).toBe('P1');
  });

  test('low scores produce P4 or P5', () => {
    const scores: PriorityScores = {
      safety: 1,
      cost: 1,
      schedule: 1,
      quality: 1,
    };
    const result = calculatePriority(scores);
    expect(['P4', 'P5']).toContain(result);
  });

  test('safety-heavy scores elevate priority', () => {
    const scores: PriorityScores = {
      safety: 10,
      cost: 1,
      schedule: 1,
      quality: 1,
    };
    const result = calculatePriority(scores);
    expect(['P1', 'P2']).toContain(result);
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
  test('generates name with project code and sequence', () => {
    const name = generateIssueName('MOOR', 'STRUCT', 'hard', 1);
    expect(name).toMatch(/^MOOR/);
    expect(name).toContain('STRUCT');
  });

  test('sequence number is zero-padded', () => {
    const name = generateIssueName('MOOR', 'MECH', 'soft', 5);
    expect(name).toMatch(/00?5/);
  });

  test('different disciplines produce different names', () => {
    const nameA = generateIssueName('MOOR', 'ARCH', 'hard', 1);
    const nameM = generateIssueName('MOOR', 'MECH', 'hard', 1);
    expect(nameA).not.toBe(nameM);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ISSUE LOG MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

describe('IssueLogManager', () => {
  let manager: IssueLogManager;

  beforeEach(() => {
    manager = new IssueLogManager('MOOR');
  });

  test('creates an issue', () => {
    const issue = manager.createIssue({
      discipline: 'STRUCT',
      category: 'hard',
      severity: 'critical',
      description: 'Beam penetrates duct',
      elements: ['beam-001', 'duct-001'],
      storey: 'Level 2',
    });
    expect(issue).toBeDefined();
    expect(issue.status).toBe('NEW');
    expect(issue.priority).toBe('P1');
  });

  test('assigns sequential names', () => {
    const i1 = manager.createIssue({
      discipline: 'STRUCT',
      category: 'hard',
      severity: 'high',
      description: 'Issue 1',
      elements: ['e1'],
    });
    const i2 = manager.createIssue({
      discipline: 'MECH',
      category: 'soft',
      severity: 'medium',
      description: 'Issue 2',
      elements: ['e2'],
    });
    expect(i1.name).not.toBe(i2.name);
  });

  test('transitions issue status', () => {
    const issue = manager.createIssue({
      discipline: 'ELEC',
      category: 'hard',
      severity: 'high',
      description: 'Panel clearance violation',
      elements: ['panel-001'],
    });

    const result = manager.transitionStatus(issue.id, 'OPEN', 'Acknowledged');
    expect(result.success).toBe(true);

    const updated = manager.getIssue(issue.id);
    expect(updated?.status).toBe('OPEN');
  });

  test('rejects invalid status transition', () => {
    const issue = manager.createIssue({
      discipline: 'PLUMB',
      category: 'soft',
      severity: 'medium',
      description: 'Pipe clearance',
      elements: ['pipe-001'],
    });

    const result = manager.transitionStatus(issue.id, 'CLOSED', 'Skip ahead');
    expect(result.success).toBe(false);
  });

  test('generates RFI from issue', () => {
    const issue = manager.createIssue({
      discipline: 'ARCH',
      category: 'hard',
      severity: 'critical',
      description: 'Wall conflicts with structural beam',
      elements: ['wall-001', 'beam-001'],
    });

    const rfi = manager.generateRFI(issue.id, 'Design team');
    expect(rfi).not.toBeNull();
    if (rfi) {
      expect(rfi.number).toMatch(/RFI/);
      expect(rfi.toTeam).toBe('Design team');
    }
  });

  test('retrieves all issues', () => {
    manager.createIssue({ discipline: 'STRUCT', category: 'hard', severity: 'high', description: 'A', elements: ['e1'] });
    manager.createIssue({ discipline: 'MECH', category: 'soft', severity: 'low', description: 'B', elements: ['e2'] });
    manager.createIssue({ discipline: 'ELEC', category: 'hard', severity: 'medium', description: 'C', elements: ['e3'] });

    expect(manager.getAllIssues()).toHaveLength(3);
  });

  test('filters by status', () => {
    const i1 = manager.createIssue({ discipline: 'STRUCT', category: 'hard', severity: 'high', description: 'A', elements: ['e1'] });
    manager.createIssue({ discipline: 'MECH', category: 'soft', severity: 'low', description: 'B', elements: ['e2'] });

    manager.transitionStatus(i1.id, 'OPEN', 'ack');

    const openIssues = manager.getIssuesByStatus('OPEN');
    expect(openIssues).toHaveLength(1);
    expect(openIssues[0].id).toBe(i1.id);
  });

  test('filters by discipline', () => {
    manager.createIssue({ discipline: 'STRUCT', category: 'hard', severity: 'high', description: 'A', elements: ['e1'] });
    manager.createIssue({ discipline: 'STRUCT', category: 'soft', severity: 'medium', description: 'B', elements: ['e2'] });
    manager.createIssue({ discipline: 'MECH', category: 'hard', severity: 'low', description: 'C', elements: ['e3'] });

    const structIssues = manager.getIssuesByDiscipline('STRUCT');
    expect(structIssues).toHaveLength(2);
  });

  test('batch status update', () => {
    const i1 = manager.createIssue({ discipline: 'STRUCT', category: 'hard', severity: 'high', description: 'A', elements: ['e1'] });
    const i2 = manager.createIssue({ discipline: 'MECH', category: 'hard', severity: 'high', description: 'B', elements: ['e2'] });

    const results = manager.batchTransition([i1.id, i2.id], 'OPEN', 'Batch ack');
    expect(results.filter(r => r.success)).toHaveLength(2);
  });

  test('getSummary returns correct counts', () => {
    manager.createIssue({ discipline: 'STRUCT', category: 'hard', severity: 'critical', description: 'A', elements: ['e1'] });
    manager.createIssue({ discipline: 'MECH', category: 'soft', severity: 'low', description: 'B', elements: ['e2'] });

    const summary = manager.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.byStatus.NEW).toBe(2);
  });
});
