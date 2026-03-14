/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BCF EXPORT + VIEWPOINT GENERATOR + TREND ANALYTICS + PENETRATIONS MATRIX
 *  50+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── MOCKS ──────────────────────────────────────────────────────────────────

jest.mock('crypto', () => ({
  randomUUID: () => 'mock-uuid-0000-0000-0000-000000000000',
}));

// ─── BCF EXPORT ─────────────────────────────────────────────────────────────

import {
  generateBCFTopics,
  serializeBCFToXML,
  generateIssueCSV,
  generateClashCSV,
  generateHTMLMeetingSummary,
} from '../bcf-export';

import type { IssueRecord, IssueStatus, IssuePriority, StatusTransition } from '../issue-log';
import type { RawClash } from '../spatial-clash-engine';
import type { ClashGroup } from '../dedup-engine';

/** Helper to build a minimal valid IssueRecord */
function makeIssue(overrides: Partial<IssueRecord> & { id: string; name: string }): IssueRecord {
  return {
    issueNumber: 'ISS-0001',
    testId: 'CD-001',
    type: 'hard_clash',
    zone: 'L01_EAST',
    gridRef: 'C4',
    priority: 'P1' as IssuePriority,
    owner: 'StructEng',
    assignedTo: 'JSmith',
    originDiscipline: 'structural',
    status: 'OPEN' as IssueStatus,
    createdDate: '2025-03-01T00:00:00Z',
    targetDate: '2025-04-01T00:00:00Z',
    resolvedDate: null,
    description: 'Beam-duct clash at Level 1',
    recommendation: 'Reroute duct',
    resolution: null,
    clashGroupId: null,
    rfiNumber: null,
    priorityScores: null,
    elementIds: ['beam-001', 'duct-001'],
    codeReferences: [],
    statusHistory: [] as StatusTransition[],
    attachments: [],
    tags: [],
    ...overrides,
  } as IssueRecord;
}

describe('bcf-export.ts', () => {
  const sampleIssues: IssueRecord[] = [
    makeIssue({
      id: 'iss-001',
      name: 'MOOR-STR-001',
      description: 'Beam-duct clash',
      elementIds: ['beam-001', 'duct-001'],
      status: 'OPEN',
      priority: 'P1',
      zone: 'Level 1',
    }),
    makeIssue({
      id: 'iss-002',
      name: 'MOOR-MECH-001',
      description: 'Pipe clearance',
      elementIds: ['pipe-001'],
      status: 'IN_PROGRESS',
      priority: 'P3',
      zone: 'Level 2',
    }),
  ];

  /** Build minimal RawClash objects that match the real RawClash interface */
  function makeRawClash(overrides: Partial<RawClash> & { id: string }): RawClash {
    return {
      testId: 'CD-001',
      category: 'hard',
      severity: 'critical',
      elementA: {
        id: 'beam-001', elementId: 'beam-001', name: 'Beam-001', elementType: 'IfcBeam',
        discipline: 'structural', storey: 'Level 1', zone: 'EAST', gridRef: 'C4',
        bbox: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      },
      elementB: {
        id: 'duct-001', elementId: 'duct-001', name: 'Duct-001', elementType: 'IfcDuctSegment',
        discipline: 'mechanical', storey: 'Level 1', zone: 'EAST', gridRef: 'C4',
        bbox: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      },
      overlapVolume_m3: 0.05,
      clearanceRequired_mm: 50,
      clearanceActual_mm: -10,
      penetrationDepth_mm: 50,
      location: { x: 5, y: 3, z: 2.5 },
      description: 'Hard clash between beam and duct',
      codeReferences: ['NBC 3.1.8'],
      ...overrides,
    } as RawClash;
  }

  const sampleClashes: RawClash[] = [
    makeRawClash({ id: 'c1-0000-0000' }),
    makeRawClash({
      id: 'c2-0000-0000',
      elementA: {
        id: 'pipe-001', elementId: 'pipe-001', name: 'Pipe-001', elementType: 'IfcPipeSegment',
        discipline: 'plumbing', storey: 'Level 2', zone: 'WEST', gridRef: 'D5',
        bbox: { minX: 8, minY: 6, minZ: 0, maxX: 12, maxY: 10, maxZ: 2 },
      } as any,
      elementB: {
        id: 'wall-001', elementId: 'wall-001', name: 'Wall-001', elementType: 'IfcWall',
        discipline: 'structural', storey: 'Level 2', zone: 'WEST', gridRef: 'D5',
        bbox: { minX: 9, minY: 7, minZ: 0, maxX: 11, maxY: 9, maxZ: 3 },
      } as any,
      category: 'soft',
      severity: 'medium',
      penetrationDepth_mm: 0,
      location: { x: 10, y: 8, z: 1 },
    }),
  ];

  test('generateBCFTopics produces topics from issues', () => {
    const topics = generateBCFTopics(sampleIssues);
    expect(topics.length).toBe(2);
    expect(topics[0]).toHaveProperty('guid');
    expect(topics[0]).toHaveProperty('title');
    expect(topics[0]).toHaveProperty('topicStatus');
  });

  test('BCF topics have valid GUIDs', () => {
    const topics = generateBCFTopics(sampleIssues);
    for (const t of topics) {
      expect(t.guid.length).toBeGreaterThan(0);
    }
  });

  test('BCF topic title matches issue name', () => {
    const topics = generateBCFTopics(sampleIssues);
    expect(topics[0].title).toBe('MOOR-STR-001');
    expect(topics[1].title).toBe('MOOR-MECH-001');
  });

  test('BCF topic components correspond to elementIds', () => {
    const topics = generateBCFTopics(sampleIssues);
    expect(topics[0].components.length).toBe(2);
    expect(topics[0].components[0].ifcGuid).toBe('beam-001');
    expect(topics[0].components[1].ifcGuid).toBe('duct-001');
  });

  test('serializeBCFToXML returns map of filenames to XML', () => {
    const topics = generateBCFTopics(sampleIssues);
    const xmlMap = serializeBCFToXML(topics);
    expect(xmlMap).toBeInstanceOf(Map);
    expect(xmlMap.size).toBeGreaterThan(0);
    for (const [, xml] of xmlMap) {
      expect(xml).toContain('<?xml');
    }
  });

  test('serializeBCFToXML includes version and project files', () => {
    const topics = generateBCFTopics(sampleIssues);
    const xmlMap = serializeBCFToXML(topics, 'TestProject');
    expect(xmlMap.has('bcf.version')).toBe(true);
    expect(xmlMap.has('project.bcfp')).toBe(true);
    expect(xmlMap.get('project.bcfp')).toContain('TestProject');
  });

  test('generateIssueCSV produces valid CSV', () => {
    const csv = generateIssueCSV(sampleIssues);
    expect(typeof csv).toBe('string');
    expect(csv.length).toBeGreaterThan(0);
    expect(csv).toContain(',');
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThan(1); // header + data
  });

  test('generateClashCSV produces valid CSV', () => {
    const csv = generateClashCSV(sampleClashes);
    expect(typeof csv).toBe('string');
    expect(csv).toContain('Beam-001');
    expect(csv).toContain('Duct-001');
  });

  test('generateHTMLMeetingSummary returns HTML string', () => {
    const html = generateHTMLMeetingSummary({
      projectName: 'The Moorings',
      meetingDate: '2025-03-15',
      attendees: ['PM', 'Architect', 'Structural Eng'],
      issues: sampleIssues,
      clashGroups: [],
    });
    expect(html).toContain('<html');
    expect(html).toContain('The Moorings');
  });

  test('generateHTMLMeetingSummary includes stat cards', () => {
    const html = generateHTMLMeetingSummary({
      projectName: 'Test Project',
      meetingDate: '2025-03-15',
      attendees: ['PM'],
      issues: sampleIssues,
      clashGroups: [],
    });
    expect(html).toContain('Total Issues');
    expect(html).toContain('Open');
  });

  test('empty issues returns empty CSV with header', () => {
    const csv = generateIssueCSV([]);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1); // just header
  });
});

// ─── VIEWPOINT GENERATOR ────────────────────────────────────────────────────

import {
  generateViewpointSet,
  generateAllViewpoints,
} from '../viewpoint-generator';


describe('viewpoint-generator.ts', () => {
  /** Build a minimal ClashGroup for testing */
  function makeClashGroup(overrides: Partial<ClashGroup> = {}): ClashGroup {
    return {
      groupId: 'grp-001',
      description: 'Test clash group',
      rootCauseElementId: 'beam-001',
      affectedElements: ['duct-001'],
      clashes: [
        {
          id: 'c1', testId: 'CD-001', category: 'hard', severity: 'critical',
          elementA: {
            id: 'beam-001', elementId: 'beam-001', name: 'Beam-001', elementType: 'IfcBeam',
            discipline: 'structural', storey: 'Level 1', zone: 'EAST', gridRef: 'C4',
            bbox: { minX: 3, minY: 1, minZ: 1, maxX: 7, maxY: 5, maxZ: 4 },
          },
          elementB: {
            id: 'duct-001', elementId: 'duct-001', name: 'Duct-001', elementType: 'IfcDuctSegment',
            discipline: 'mechanical', storey: 'Level 1', zone: 'EAST', gridRef: 'C4',
            bbox: { minX: 4, minY: 2, minZ: 2, maxX: 6, maxY: 4, maxZ: 3 },
          },
          overlapVolume_m3: 0.05,
          clearanceRequired_mm: 50,
          clearanceActual_mm: -10,
          penetrationDepth_mm: 50,
          location: { x: 5, y: 3, z: 2.5 },
          description: 'Beam-duct clash',
          codeReferences: [],
        },
      ],
      ...overrides,
    } as unknown as ClashGroup;
  }

  test('generateViewpointSet returns ISO, SEC, PLAN viewpoints', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    expect(set).toBeDefined();
    expect(set.viewpoints.length).toBe(3);
    expect(set.viewpoints[0].type).toBe('ISO');
    expect(set.viewpoints[1].type).toBe('SEC');
    expect(set.viewpoints[2].type).toBe('PLAN');
  });

  test('viewpoints have valid camera setups', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    for (const vp of set.viewpoints) {
      expect(vp.camera).toBeDefined();
      expect(vp.camera.eyePosition).toBeDefined();
      expect(vp.camera.lookAt).toBeDefined();
      expect(vp.camera.upVector).toBeDefined();
      expect(vp.camera.fieldOfView).toBeGreaterThan(0);
    }
  });

  test('PLAN viewpoint has camera above the target', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const plan = set.viewpoints[2]; // PLAN
    expect(plan.camera.eyePosition.z).toBeGreaterThan(plan.camera.lookAt.z);
  });

  test('SEC viewpoint has section plane', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const sec = set.viewpoints[1]; // SEC
    expect(sec.sectionPlane).toBeDefined();
    expect(sec.sectionPlane).not.toBeNull();
    expect(sec.sectionPlane!.origin).toBeDefined();
    expect(sec.sectionPlane!.normal).toBeDefined();
  });

  test('ISO viewpoint has no section plane', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const iso = set.viewpoints[0]; // ISO
    expect(iso.sectionPlane).toBeNull();
  });

  test('viewpoints have color overrides for clashing elements', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    for (const vp of set.viewpoints) {
      expect(vp.colorOverrides).toBeDefined();
      expect(vp.colorOverrides.length).toBeGreaterThan(0);
    }
  });

  test('color overrides include offender in red', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const offender = set.viewpoints[0].colorOverrides.find(c => c.role === 'offender');
    expect(offender).toBeDefined();
    expect(offender!.color).toBe('FF0000');
  });

  test('color overrides include victim in amber', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const victim = set.viewpoints[0].colorOverrides.find(c => c.role === 'victim');
    expect(victim).toBeDefined();
    expect(victim!.color).toBe('FF8C00');
  });

  test('viewpoint IDs follow naming convention', () => {
    const group = makeClashGroup({ groupId: 'grp-test-001' });
    const set = generateViewpointSet(group);
    expect(set.viewpoints[0].id).toBe('grp-test-001__ISO');
    expect(set.viewpoints[1].id).toBe('grp-test-001__SEC');
    expect(set.viewpoints[2].id).toBe('grp-test-001__PLAN');
  });

  test('viewpointSet has groupId and groupDescription', () => {
    const group = makeClashGroup({ groupId: 'grp-x', description: 'X group' });
    const set = generateViewpointSet(group);
    expect(set.groupId).toBe('grp-x');
    expect(set.groupDescription).toBe('X group');
  });

  test('generateAllViewpoints produces sets for multiple groups', () => {
    const groups = [
      makeClashGroup({ groupId: 'grp-1', description: 'Group 1' }),
      makeClashGroup({ groupId: 'grp-2', description: 'Group 2' }),
    ];
    const sets = generateAllViewpoints(groups);
    expect(sets.length).toBe(2);
    expect(sets[0].groupId).toBe('grp-1');
    expect(sets[1].groupId).toBe('grp-2');
  });

  test('viewpoints have visibility overrides', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    for (const vp of set.viewpoints) {
      expect(vp.visibilityOverrides).toBeDefined();
      expect(vp.visibilityOverrides.length).toBeGreaterThan(0);
    }
  });

  test('ISO viewpoint camera is offset from target', () => {
    const group = makeClashGroup();
    const set = generateViewpointSet(group);
    const iso = set.viewpoints[0];
    expect(iso.camera.eyePosition.x).not.toBe(iso.camera.lookAt.x);
  });
});

// ─── TREND ANALYTICS ────────────────────────────────────────────────────────

import {
  buildTrendDataPoints,
  calculateVelocity,
  identifyHotspots,
  analyzeRootCauseTrends,
  generateTrendReport,
  generateAlerts,
  calculateBurndown,
} from '../trend-analytics';

import type {
  VelocityMetrics,
  MilestoneDefinition,
} from '../trend-analytics';
import type { DeltaSummary } from '../delta-tracker';

describe('trend-analytics.ts', () => {
  /** Build a minimal valid DeltaSummary */
  function makeDelta(overrides: Partial<DeltaSummary> & { runId: string }): DeltaSummary {
    return {
      previousRunId: 'prev-run',
      runDate: '2025-02-01',
      newCount: 10,
      persistentCount: 20,
      resolvedCount: 2,
      regressionCount: 0,
      totalCurrent: 30,
      totalPrevious: 22,
      netChange: 8,
      bySeverity: {} as any,
      byZone: {} as any,
      regressions: [],
      ...overrides,
    } as DeltaSummary;
  }

  const sampleDeltas: DeltaSummary[] = [
    makeDelta({ runId: 'd1', runDate: '2025-02-01', newCount: 10, resolvedCount: 2, persistentCount: 20, regressionCount: 0, totalCurrent: 30, totalPrevious: 22, netChange: 8 }),
    makeDelta({ runId: 'd2', runDate: '2025-02-08', newCount: 8, resolvedCount: 5, persistentCount: 23, regressionCount: 1, totalCurrent: 27, totalPrevious: 24, netChange: 4 }),
    makeDelta({ runId: 'd3', runDate: '2025-02-15', newCount: 5, resolvedCount: 10, persistentCount: 18, regressionCount: 0, totalCurrent: 23, totalPrevious: 28, netChange: -5 }),
    makeDelta({ runId: 'd4', runDate: '2025-02-22', newCount: 3, resolvedCount: 8, persistentCount: 13, regressionCount: 0, totalCurrent: 16, totalPrevious: 21, netChange: -5 }),
  ];

  test('buildTrendDataPoints converts deltas to data points', () => {
    const points = buildTrendDataPoints(sampleDeltas);
    expect(points.length).toBe(4);
    for (const p of points) {
      expect(p).toHaveProperty('date');
      expect(p).toHaveProperty('total');
      expect(p).toHaveProperty('newCount');
      expect(p).toHaveProperty('resolvedCount');
    }
  });

  test('buildTrendDataPoints preserves runId', () => {
    const points = buildTrendDataPoints(sampleDeltas);
    expect(points[0].runId).toBe('d1');
    expect(points[3].runId).toBe('d4');
  });

  test('calculateVelocity computes resolution rate', () => {
    const velocity = calculateVelocity(sampleDeltas);
    expect(velocity).toBeDefined();
    expect(velocity.avgResolvedPerDrop).toBeGreaterThan(0);
  });

  test('calculateVelocity returns valid metrics shape', () => {
    const velocity = calculateVelocity(sampleDeltas);
    expect(velocity).toHaveProperty('avgNewPerDrop');
    expect(velocity).toHaveProperty('avgResolvedPerDrop');
    expect(velocity).toHaveProperty('netVelocity');
    expect(velocity).toHaveProperty('resolutionRate');
    expect(velocity).toHaveProperty('regressionRate');
    expect(velocity).toHaveProperty('trend');
  });

  test('calculateVelocity with empty deltas returns zero metrics', () => {
    const velocity = calculateVelocity([]);
    expect(velocity.avgNewPerDrop).toBe(0);
    expect(velocity.avgResolvedPerDrop).toBe(0);
    expect(velocity.trend).toBe('stable');
  });

  test('calculateVelocity trend is improving when net change decreases', () => {
    const velocity = calculateVelocity(sampleDeltas);
    // Recent deltas have negative netChange vs early positive, so should be improving
    expect(velocity.trend).toBe('improving');
  });

  test('identifyHotspots returns array', () => {
    const hotspots = identifyHotspots(sampleDeltas);
    expect(Array.isArray(hotspots)).toBe(true);
  });

  test('identifyHotspots with zone data finds problem areas', () => {
    const deltasWithZones: DeltaSummary[] = [
      makeDelta({
        runId: 'dz1',
        byZone: {
          'Level_1_EAST': { new: 10, persistent: 15, resolved: 3, regression: 2 },
          'Level_2_WEST': { new: 1, persistent: 1, resolved: 0, regression: 0 },
        } as any,
      }),
    ];
    const hotspots = identifyHotspots(deltasWithZones);
    expect(hotspots.length).toBeGreaterThan(0);
    // First hotspot should be the higher-risk zone
    expect(hotspots[0].zone).toBe('Level_1_EAST');
  });

  test('analyzeRootCauseTrends categorizes causes', () => {
    const issues = [
      makeIssue({ id: 'i1', name: 'I1', type: 'hard_clash' }),
      makeIssue({ id: 'i2', name: 'I2', type: 'hard_clash' }),
      makeIssue({ id: 'i3', name: 'I3', type: 'soft_clash' }),
    ];
    const trends = analyzeRootCauseTrends(sampleDeltas, issues);
    expect(Array.isArray(trends)).toBe(true);
  });

  test('analyzeRootCauseTrends with < 2 deltas returns empty', () => {
    const trends = analyzeRootCauseTrends([sampleDeltas[0]], []);
    expect(trends).toHaveLength(0);
  });

  test('generateTrendReport returns full report', () => {
    const issues = [
      makeIssue({ id: 'i1', name: 'I1', status: 'OPEN' }),
      makeIssue({ id: 'i2', name: 'I2', status: 'RESOLVED', resolvedDate: '2025-02-20' }),
    ];
    const milestones: MilestoneDefinition[] = [
      { name: 'IFC Stage', date: '2025-06-01', targetZeroClashes: true },
    ];
    const report = generateTrendReport(sampleDeltas, issues, milestones);
    expect(report).toHaveProperty('velocity');
    expect(report).toHaveProperty('dataPoints');
    expect(report).toHaveProperty('burndownTargets');
    expect(report).toHaveProperty('hotspots');
    expect(report).toHaveProperty('alerts');
    expect(report).toHaveProperty('dropCount');
    expect(report.dropCount).toBe(4);
  });

  test('generateTrendReport velocity trend is improving when net change is negative', () => {
    const issues: IssueRecord[] = [];
    const milestones: MilestoneDefinition[] = [];
    const report = generateTrendReport(sampleDeltas, issues, milestones);
    expect(report.velocity.trend).toBe('improving');
  });

  test('generateAlerts returns alerts for anomalies', () => {
    const velocity = calculateVelocity(sampleDeltas);
    const alerts = generateAlerts(velocity, [], []);
    expect(Array.isArray(alerts)).toBe(true);
  });

  test('generateAlerts flags high regression rate', () => {
    const badVelocity: VelocityMetrics = {
      avgNewPerDrop: 10,
      avgResolvedPerDrop: 2,
      netVelocity: 8,
      resolutionRate: 0.15,
      regressionRate: 0.12,
      trend: 'degrading',
    };
    const alerts = generateAlerts(badVelocity, [], []);
    const regressionAlert = alerts.find(a => a.metric === 'regressionRate');
    expect(regressionAlert).toBeDefined();
    expect(regressionAlert!.level).toBe('critical');
  });

  test('calculateBurndown computes burndown targets', () => {
    const velocity = calculateVelocity(sampleDeltas);
    const milestones: MilestoneDefinition[] = [
      { name: 'IFC Stage', date: '2025-06-01', targetZeroClashes: true },
    ];
    const targets = calculateBurndown(30, velocity, milestones);
    expect(targets).toBeDefined();
    expect(targets.length).toBe(1);
    expect(targets[0]).toHaveProperty('requiredWeeklyRate');
    expect(targets[0].requiredWeeklyRate).toBeGreaterThan(0);
  });

  test('calculateBurndown flags off-track milestones', () => {
    const zeroVelocity: VelocityMetrics = {
      avgNewPerDrop: 5,
      avgResolvedPerDrop: 0,
      netVelocity: 5,
      resolutionRate: 0,
      regressionRate: 0,
      trend: 'degrading',
    };
    const milestones: MilestoneDefinition[] = [
      { name: 'Deadline', date: '2025-06-01', targetZeroClashes: true },
    ];
    const targets = calculateBurndown(100, zeroVelocity, milestones);
    expect(targets[0].onTrack).toBe(false);
  });
});

// ─── PENETRATIONS MATRIX ────────────────────────────────────────────────────

import {
  buildPenetrationMatrix,
  exportPenetrationMatrixCSV,
  comparePenetrationMatrices,
} from '../penetrations-matrix';

import type { PenetrationRecord, PenetrationStatus } from '../discipline-tests';

describe('penetrations-matrix.ts', () => {
  /** Build a minimal valid PenetrationRecord */
  function makePenetration(overrides: Partial<PenetrationRecord> & { id: string }): PenetrationRecord {
    return {
      level: 'Level 1',
      zone: 'EAST',
      gridRef: 'C4',
      hostElement: { id: 'wall-001', name: 'Wall-001', type: 'IfcWall', discipline: 'structural' as any },
      penetratingElement: { id: 'pipe-001', name: 'Pipe-001', type: 'IfcPipeSegment', discipline: 'plumbing' as any },
      sleevePresent: true,
      sleeveId: 'sleeve-001',
      firestopSystem: 'FS-100',
      fireRatingRequired: '2HR',
      fireRatingProvided: '2HR',
      penetrationSize_mm: 100,
      status: 'OK' as PenetrationStatus,
      rfiRequired: false,
      description: 'Standard pipe penetration through wall',
      ...overrides,
    };
  }

  const samplePenetrations: PenetrationRecord[] = [
    makePenetration({
      id: 'pen-001',
      hostElement: { id: 'wall-001', name: 'Wall-001', type: 'IfcWall', discipline: 'structural' as any },
      penetratingElement: { id: 'pipe-001', name: 'Pipe-001', type: 'IfcPipeSegment', discipline: 'plumbing' as any },
      level: 'Level 1',
      penetrationSize_mm: 100,
      status: 'OK',
    }),
    makePenetration({
      id: 'pen-002',
      hostElement: { id: 'wall-001', name: 'Wall-001', type: 'IfcWall', discipline: 'structural' as any },
      penetratingElement: { id: 'duct-001', name: 'Duct-001', type: 'IfcDuctSegment', discipline: 'mechanical' as any },
      level: 'Level 1',
      penetrationSize_mm: 400,
      status: 'SLEEVE_MISSING',
      sleevePresent: false,
      sleeveId: null,
    }),
    makePenetration({
      id: 'pen-003',
      hostElement: { id: 'slab-001', name: 'Slab-001', type: 'IfcSlab', discipline: 'structural' as any },
      penetratingElement: { id: 'pipe-002', name: 'Pipe-002', type: 'IfcPipeSegment', discipline: 'plumbing' as any },
      level: 'Level 2',
      penetrationSize_mm: 75,
      status: 'OK',
    }),
    makePenetration({
      id: 'pen-004',
      hostElement: { id: 'beam-001', name: 'Beam-001', type: 'IfcBeam', discipline: 'structural' as any },
      penetratingElement: { id: 'cable-001', name: 'Cable-001', type: 'IfcCableTray', discipline: 'electrical' as any },
      level: 'Level 1',
      penetrationSize_mm: null as any,
      status: 'SIZE_UNKNOWN',
    }),
  ];

  test('buildPenetrationMatrix creates matrix from penetration records', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    expect(matrix).toBeDefined();
    expect(matrix.rows.length).toBeGreaterThan(0);
    expect(matrix.globalSummary.total).toBe(4);
  });

  test('matrix tracks by level', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const level1Row = matrix.rows.find(r => r.level === 'Level 1');
    expect(level1Row).toBeDefined();
    expect(level1Row!.totalPenetrations).toBe(3);
  });

  test('matrix rows have cells by discipline pair', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const level1Row = matrix.rows.find(r => r.level === 'Level 1');
    expect(level1Row!.cells.length).toBeGreaterThan(0);
  });

  test('matrix global summary tracks by status', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    expect(matrix.globalSummary.byStatus).toBeDefined();
    expect(matrix.globalSummary.byStatus.OK).toBe(2);
    expect(matrix.globalSummary.byStatus.SLEEVE_MISSING).toBe(1);
  });

  test('matrix global summary has completion percent', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    expect(matrix.globalSummary.completionPercent).toBeDefined();
    // 2 OK out of 4 = 50%
    expect(matrix.globalSummary.completionPercent).toBe(50);
  });

  test('matrix has discipline pairs', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    expect(matrix.disciplinePairs.length).toBeGreaterThan(0);
  });

  test('exportPenetrationMatrixCSV returns valid CSV', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const csv = exportPenetrationMatrixCSV(matrix);
    expect(typeof csv).toBe('string');
    expect(csv).toContain('Level 1');
    expect(csv).toContain(',');
  });

  test('exportPenetrationMatrixCSV includes headers', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const csv = exportPenetrationMatrixCSV(matrix);
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toContain('Level');
    expect(headerLine).toContain('Total');
    expect(headerLine).toContain('OK');
  });

  test('comparePenetrationMatrices detects additions', () => {
    const matrixSmall = buildPenetrationMatrix(samplePenetrations.slice(0, 2));
    const matrixFull = buildPenetrationMatrix(samplePenetrations);
    // current=matrixFull (has Level 2), previous=matrixSmall (no Level 2)
    const deltas = comparePenetrationMatrices(matrixFull, matrixSmall);
    expect(deltas).toBeDefined();
    expect(Array.isArray(deltas)).toBe(true);
    // Level 2 is new in the current matrix
    const level2Delta = deltas.find(d => d.level === 'Level 2');
    expect(level2Delta).toBeDefined();
    expect(level2Delta!.currentTotal).toBeGreaterThan(0);
    expect(level2Delta!.newPenetrations).toBeGreaterThan(0);
  });

  test('comparePenetrationMatrices with identical matrices shows stable direction', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const deltas = comparePenetrationMatrices(matrix, matrix);
    for (const d of deltas) {
      expect(d.direction).toBe('stable');
      expect(d.newPenetrations).toBe(0);
    }
  });

  test('comparePenetrationMatrices returns per-level deltas', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations);
    const deltas = comparePenetrationMatrices(matrix, matrix);
    expect(deltas.length).toBe(matrix.levels.length);
    for (const d of deltas) {
      expect(d).toHaveProperty('level');
      expect(d).toHaveProperty('previousTotal');
      expect(d).toHaveProperty('currentTotal');
      expect(d).toHaveProperty('direction');
    }
  });

  test('empty penetrations returns empty matrix', () => {
    const matrix = buildPenetrationMatrix([]);
    expect(matrix.globalSummary.total).toBe(0);
    expect(matrix.rows).toHaveLength(0);
  });

  test('empty penetrations has 100% completion', () => {
    const matrix = buildPenetrationMatrix([]);
    expect(matrix.globalSummary.completionPercent).toBe(100);
  });
});
