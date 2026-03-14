/**
 * ==============================================================================
 *  SOP PARTS 10-13 -- Delta Tracking, Discipline Tests, Governance
 * ==============================================================================
 */

// --- Mocks for storage / DB layer (transitive deps) -------------------------

jest.mock('../../storage', () => ({
  storage: {
    getProject: jest.fn(),
    getModel: jest.fn(),
  },
}));

jest.mock('../../db', () => ({
  db: {},
}));

// --- Mocks for spatial-clash-engine (used by delta-tracker & discipline-tests) -

jest.mock('../spatial-clash-engine', () => ({
  aabbOverlaps: jest.fn(() => false),
  aabbMinDistance: jest.fn(() => 10),
  aabbOverlapVolume: jest.fn(() => 0),
  aabbCentroid: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  expandAABB: jest.fn((box: any) => box),
  aabbPenetrationDepth: jest.fn(() => 0),
  sweepAndPrune: jest.fn(() => []),
  evaluatePair: jest.fn(() => null),
  runSpatialClashTests: jest.fn(() => ({
    rawClashes: [], testsRun: 0, pairsEvaluated: 0,
    gapTolerances: [], warnings: [], timings: {},
  })),
}));

// --- Mocks for other transitive dependencies ---------------------------------

jest.mock('../dedup-engine', () => ({}));

jest.mock('../clash-detection-engine', () => ({}));

jest.mock('../clash-test-templates', () => ({
  resolveSelectionSet: jest.fn(() => ({ matchedIds: [], warnings: [] })),
  getSelectionSet: jest.fn(() => null),
  getEnabledTemplates: jest.fn(() => []),
}));

jest.mock('../issue-log', () => ({
  STATUS_TRANSITIONS: {},
  isValidTransition: jest.fn(),
  calculatePriority: jest.fn(),
  priorityFromSeverity: jest.fn(),
  generateIssueName: jest.fn(),
  IssueLogManager: jest.fn(),
}));

jest.mock('../trend-analytics', () => ({
  generateTrendReport: jest.fn(),
  buildTrendDataPoints: jest.fn(() => []),
  calculateVelocity: jest.fn(() => ({
    avgNewPerDrop: 0, avgResolvedPerDrop: 0, netVelocity: 0,
    resolutionRate: 0, regressionRate: 0, trend: 'stable',
  })),
  identifyHotspots: jest.fn(() => []),
  analyzeRootCauseTrends: jest.fn(() => []),
  generateAlerts: jest.fn(() => []),
  calculateBurndown: jest.fn(() => []),
}));

jest.mock('../milestone-protection', () => ({
  assessMilestoneProtection: jest.fn(() => ({
    generatedDate: new Date().toISOString(),
    milestones: [],
    criticalCount: 0,
    highCount: 0,
    immediateActions: [],
    summary: 'No milestones assessed',
  })),
}));

jest.mock('../schedule-linkage', () => ({
  linkScheduleToIssues: jest.fn(() => ({ links: [], warnings: [] })),
}));

// --- DELTA TRACKER (SOP Part 10) ---------------------------------------------

import {
  computeDelta,
  DropHistory,
  type DeltaSummary,
  type DropSnapshot,
} from '../delta-tracker';

describe('delta-tracker.ts', () => {
  // Helper: create a minimal RawClash-compatible object
  function makeClash(
    id: string,
    testId: string,
    zone: string,
    elAId: string,
    elBId: string,
    locX: number = 0,
  ) {
    return {
      id,
      testId,
      severity: 'medium' as const,
      description: `Clash ${id}`,
      location: { x: locX, y: 0, z: 0 },
      elementA: {
        id: elAId,
        elementId: elAId,
        name: `Element ${elAId}`,
        elementType: 'pipe',
        discipline: 'mechanical',
        storey: zone,
        properties: {},
      },
      elementB: {
        id: elBId,
        elementId: elBId,
        name: `Element ${elBId}`,
        elementType: 'beam',
        discipline: 'structural',
        storey: zone,
        properties: {},
      },
    } as any;
  }

  // Persistent clashes reuse exact same element IDs so strict matching works.
  // New clashes use unique element IDs and far-away locations / different zones
  // to avoid fuzzy matching.
  const prevClashes = [
    makeClash('c1', 'T1', 'Level 1', 'el-a1', 'el-b1', 0),
    makeClash('c2', 'T1', 'Level 1', 'el-a2', 'el-b2', 10),
    makeClash('c3', 'T1', 'Level 2', 'el-a3', 'el-b3', 20),
  ];
  const currClashes = [
    makeClash('c2x', 'T1', 'Level 1', 'el-a2', 'el-b2', 10), // persistent (strict)
    makeClash('c3x', 'T1', 'Level 2', 'el-a3', 'el-b3', 20), // persistent (strict)
    makeClash('c4', 'T1', 'Level 3', 'el-a4', 'el-b4', 500),  // new
    makeClash('c5', 'T1', 'Level 4', 'el-a5', 'el-b5', 600),  // new
  ];

  test('computeDelta returns a DeltaSummary', () => {
    const delta: DeltaSummary = computeDelta(currClashes, prevClashes, 'run-2', 'run-1');
    expect(delta).toBeDefined();
    expect(delta).toHaveProperty('runId', 'run-2');
    expect(delta).toHaveProperty('previousRunId', 'run-1');
    expect(delta).toHaveProperty('newCount');
    expect(delta).toHaveProperty('persistentCount');
    expect(delta).toHaveProperty('resolvedCount');
  });

  test('computeDelta identifies NEW clashes', () => {
    const delta = computeDelta(currClashes, prevClashes, 'run-2', 'run-1');
    expect(delta.newCount).toBe(2); // c4, c5
  });

  test('computeDelta identifies RESOLVED clashes', () => {
    const delta = computeDelta(currClashes, prevClashes, 'run-2', 'run-1');
    expect(delta.resolvedCount).toBe(1); // c1
  });

  test('computeDelta identifies PERSISTENT clashes', () => {
    const delta = computeDelta(currClashes, prevClashes, 'run-2', 'run-1');
    expect(delta.persistentCount).toBe(2); // c2, c3
  });

  test('computeDelta with identical runs: all PERSISTENT', () => {
    const delta = computeDelta(prevClashes, prevClashes, 'run-2', 'run-1');
    expect(delta.persistentCount).toBe(prevClashes.length);
    expect(delta.newCount).toBe(0);
    expect(delta.resolvedCount).toBe(0);
  });

  test('computeDelta with empty previous: all NEW', () => {
    const delta = computeDelta(currClashes, [], 'run-2', 'run-1');
    expect(delta.newCount).toBe(currClashes.length);
    expect(delta.resolvedCount).toBe(0);
  });

  test('DropHistory tracks multiple snapshots', () => {
    const history = new DropHistory();
    const snap1: DropSnapshot = {
      runId: 'run-1',
      runDate: '2025-02-01',
      clashes: prevClashes,
      groups: [],
    };
    const snap2: DropSnapshot = {
      runId: 'run-2',
      runDate: '2025-02-08',
      clashes: currClashes,
      groups: [],
    };
    history.addSnapshot(snap1);
    history.addSnapshot(snap2);
    expect(history.getSnapshots().length).toBe(2);
  });

  test('DropHistory computes latest delta', () => {
    const history = new DropHistory();
    history.addSnapshot({
      runId: 'run-1', runDate: '2025-02-01', clashes: prevClashes, groups: [],
    });
    history.addSnapshot({
      runId: 'run-2', runDate: '2025-02-08', clashes: currClashes, groups: [],
    });
    const delta = history.getLatestDelta();
    expect(delta).not.toBeNull();
    expect(delta!.newCount).toBeGreaterThan(0);
  });

  test('DropHistory with single snapshot returns null delta', () => {
    const history = new DropHistory();
    history.addSnapshot({
      runId: 'run-1', runDate: '2025-02-01', clashes: prevClashes, groups: [],
    });
    expect(history.getLatestDelta()).toBeNull();
  });
});

// --- DISCIPLINE TESTS (SOP Part 12) -----------------------------------------

import {
  detectPenetrations,
  checkAccessPanelClearance,
  checkEquipmentClearance,
  validateShafts,
} from '../discipline-tests';

describe('discipline-tests.ts', () => {
  // detectPenetrations takes ResolvedElement[] and optional sleeveElements[]
  // It internally separates structural vs MEP and checks AABB overlaps
  test('detectPenetrations returns array', () => {
    const elements = [
      {
        id: 'wall-001', elementId: 'wall-001', name: 'Wall 1',
        elementType: 'wall', discipline: 'structural',
        storey: 'Level 1', bbox: { minX: 0, minY: 0, minZ: 0, maxX: 5, maxY: 0.2, maxZ: 3 },
        properties: {},
      },
      {
        id: 'pipe-001', elementId: 'pipe-001', name: 'Pipe 1',
        elementType: 'pipe', discipline: 'plumbing',
        storey: 'Level 1', bbox: { minX: 2, minY: -0.1, minZ: 1, maxX: 2.1, maxY: 0.3, maxZ: 1.1 },
        properties: {},
      },
    ] as any;
    const penetrations = detectPenetrations(elements);
    expect(Array.isArray(penetrations)).toBe(true);
  });

  test('checkAccessPanelClearance returns results', () => {
    const accessPoints = [
      {
        id: 'panel-001', elementId: 'panel-001', name: 'Access Panel 1',
        elementType: 'access_panel', discipline: 'mechanical',
        storey: 'Level 1', bbox: { minX: 1, minY: 0, minZ: 0.5, maxX: 1.6, maxY: 0.05, maxZ: 1.1 },
        properties: {},
      },
    ] as any;
    const allElements = [
      ...accessPoints,
      {
        id: 'pipe-001', elementId: 'pipe-001', name: 'Pipe 1',
        elementType: 'pipe', discipline: 'plumbing',
        storey: 'Level 1', bbox: { minX: 1.2, minY: 0, minZ: 0.3, maxX: 1.3, maxY: 0.1, maxZ: 0.4 },
        properties: {},
      },
    ] as any;
    const result = checkAccessPanelClearance(accessPoints, allElements);
    expect(Array.isArray(result)).toBe(true);
  });

  test('checkEquipmentClearance returns results', () => {
    const equipment = [
      {
        id: 'ahu-001', elementId: 'ahu-001', name: 'AHU 1',
        elementType: 'air_handling_unit', discipline: 'mechanical',
        storey: 'Level 1',
        bbox: { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 2 },
        properties: { ServiceClearance_mm: 900 },
      },
    ] as any;
    const allElements = [...equipment] as any;
    const result = checkEquipmentClearance(equipment, allElements);
    expect(Array.isArray(result)).toBe(true);
  });

  test('validateShafts returns results', () => {
    const shafts = [
      {
        id: 'shaft-001', elementId: 'shaft-001', name: 'Shaft 1',
        elementType: 'shaft', discipline: 'architectural',
        storey: 'Level 1',
        bbox: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 3 },
        properties: {},
      },
    ] as any;
    const routedElements: any[] = [];
    const result = validateShafts(shafts, routedElements);
    expect(Array.isArray(result)).toBe(true);
  });
});

// --- GOVERNANCE ENGINE (SOP Part 13) -----------------------------------------

import {
  DEFAULT_CADENCE,
  DEFAULT_SLAS,
  generateMeetingPack,
  trackSLAs,
  verifyClosures,
  getCurrentPhase,
} from '../governance-engine';

describe('governance-engine.ts', () => {
  test('DEFAULT_CADENCE is defined', () => {
    expect(DEFAULT_CADENCE).toBeDefined();
    expect(DEFAULT_CADENCE).toHaveProperty('meetingDay');
    expect(DEFAULT_CADENCE).toHaveProperty('meetingTime');
    expect(DEFAULT_CADENCE).toHaveProperty('modelDropCutoff_h');
  });

  test('DEFAULT_SLAS has entries', () => {
    expect(DEFAULT_SLAS.length).toBeGreaterThan(0);
    for (const sla of DEFAULT_SLAS) {
      expect(sla).toHaveProperty('priority');
      expect(sla).toHaveProperty('resolutionTarget_days');
      expect(sla).toHaveProperty('escalationAfter_days');
    }
  });

  test('getCurrentPhase returns phase info', () => {
    const phase = getCurrentPhase();
    expect(phase).toHaveProperty('phase');
    expect(phase).toHaveProperty('nextDeadline');
    expect(phase).toHaveProperty('hoursUntilDeadline');
  });

  test('generateMeetingPack returns pack with all sections', () => {
    const pack = generateMeetingPack(
      12,       // meetingNumber
      [],       // issues
      null,     // latestDelta
      null,     // trendReport
      null,     // milestoneReport
      [],       // previousActions
      'MOOR',   // projectName
    );
    expect(pack).toHaveProperty('agenda');
    expect(pack).toHaveProperty('statusSummary');
    expect(pack).toHaveProperty('meetingNumber', 12);
    expect(pack).toHaveProperty('projectName', 'MOOR');
    expect(Array.isArray(pack.agenda)).toBe(true);
    expect(pack.agenda.length).toBeGreaterThan(0);
  });

  test('trackSLAs returns SLA status for open issues', () => {
    const issues = [
      {
        id: 'iss-001', issueNumber: 'ISS-001', name: 'Test issue',
        priority: 'P1' as const, status: 'OPEN' as const,
        owner: 'StructEng', createdDate: '2025-01-01',
        targetDate: '2025-02-01', zone: 'Level 1',
        originDiscipline: 'structural', elementIds: [],
      },
    ] as any;
    const result = trackSLAs(issues, DEFAULT_SLAS);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('slaStatus');
    // Old P1 issue from Jan 2025 should be breached
    expect(result[0].slaStatus).toBe('BREACHED');
  });

  test('verifyClosures checks resolution in model', () => {
    const resolvedIssues = [
      {
        id: 'iss-001', issueNumber: 'ISS-001', name: 'Beam-duct clash',
        priority: 'P2' as const, status: 'RESOLVED' as const,
        owner: 'MechCo', createdDate: '2025-01-15',
        targetDate: '2025-02-15', resolvedDate: '2025-02-10',
        zone: 'Level 1', originDiscipline: 'mechanical', elementIds: [],
      },
    ] as any;
    const latestDelta = {
      runId: 'run-5',
      previousRunId: 'run-4',
      runDate: '2025-02-12',
      newCount: 0,
      persistentCount: 5,
      resolvedCount: 2,
      regressionCount: 0,
      totalCurrent: 5,
      totalPrevious: 7,
      netChange: -2,
      bySeverity: {},
      byZone: {},
      regressions: [],
    } as any;
    const verifications = verifyClosures(resolvedIssues, latestDelta);
    expect(Array.isArray(verifications)).toBe(true);
    expect(verifications.length).toBe(1);
    expect(verifications[0]).toHaveProperty('verificationPassed');
    // No regressions matched, so verification should pass
    expect(verifications[0].verificationPassed).toBe(true);
  });
});
