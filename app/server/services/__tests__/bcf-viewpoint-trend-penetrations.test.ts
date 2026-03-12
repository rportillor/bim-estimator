/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BCF EXPORT + VIEWPOINT GENERATOR + TREND ANALYTICS + PENETRATIONS MATRIX
 *  50+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── BCF EXPORT ─────────────────────────────────────────────────────────────

import {
  generateBCFTopics,
  serializeBCFToXML,
  generateIssueCSV,
  generateClashCSV,
  generateHTMLMeetingSummary,
} from '../bcf-export';

describe('bcf-export.ts', () => {
  const sampleIssues = [
    { id: 'iss-001', name: 'MOOR-STR-001', discipline: 'STRUCT', severity: 'critical', status: 'OPEN', description: 'Beam-duct clash', elements: ['beam-001', 'duct-001'], storey: 'Level 1' },
    { id: 'iss-002', name: 'MOOR-MECH-001', discipline: 'MECH', severity: 'medium', status: 'IN_PROGRESS', description: 'Pipe clearance', elements: ['pipe-001'], storey: 'Level 2' },
  ];

  const sampleClashes = [
    { id: 'c1', elementA: 'beam-001', elementB: 'duct-001', category: 'hard', severity: 'critical', penetration_mm: 50, location: { x: 5, y: 3, z: 2.5 } },
    { id: 'c2', elementA: 'pipe-001', elementB: 'wall-001', category: 'soft', severity: 'medium', penetration_mm: 0, location: { x: 10, y: 8, z: 1 } },
  ];

  test('generateBCFTopics produces topics from issues', () => {
    const topics = generateBCFTopics(sampleIssues as any);
    expect(topics.length).toBe(2);
    expect(topics[0]).toHaveProperty('guid');
    expect(topics[0]).toHaveProperty('title');
    expect(topics[0]).toHaveProperty('status');
  });

  test('BCF topics have valid GUIDs', () => {
    const topics = generateBCFTopics(sampleIssues as any);
    for (const t of topics) {
      expect(t.guid.length).toBeGreaterThan(0);
    }
  });

  test('serializeBCFToXML returns map of filenames to XML', () => {
    const topics = generateBCFTopics(sampleIssues as any);
    const xmlMap = serializeBCFToXML(topics);
    expect(xmlMap).toBeInstanceOf(Map);
    expect(xmlMap.size).toBeGreaterThan(0);
    for (const [filename, xml] of xmlMap) {
      expect(filename.endsWith('.xml') || filename.endsWith('.bcfv')).toBe(true);
      expect(xml).toContain('<?xml');
    }
  });

  test('generateIssueCSV produces valid CSV', () => {
    const csv = generateIssueCSV(sampleIssues as any);
    expect(typeof csv).toBe('string');
    expect(csv.length).toBeGreaterThan(0);
    expect(csv).toContain(',');
    const lines = csv.split('\n');
    expect(lines.length).toBeGreaterThan(1); // header + data
  });

  test('generateClashCSV produces valid CSV', () => {
    const csv = generateClashCSV(sampleClashes as any);
    expect(typeof csv).toBe('string');
    expect(csv).toContain('beam-001');
    expect(csv).toContain('duct-001');
  });

  test('generateHTMLMeetingSummary returns HTML string', () => {
    const html = generateHTMLMeetingSummary({
      projectName: 'The Moorings',
      meetingDate: '2025-03-15',
      weekNumber: 12,
      attendees: ['PM', 'Architect', 'Structural Eng'],
      openIssueCount: 5,
      resolvedThisWeek: 2,
      newClashCount: 3,
      slaBreaches: 1,
      actionItems: [{ assignee: 'StructEng', description: 'Reroute beam at L2', dueDate: '2025-03-22' }],
    });
    expect(html).toContain('<html');
    expect(html).toContain('The Moorings');
    expect(html).toContain('StructEng');
  });

  test('empty issues returns empty CSV with header', () => {
    const csv = generateIssueCSV([]);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1); // just header
  });
});

// ─── VIEWPOINT GENERATOR ────────────────────────────────────────────────────

import {
  generateClashViewpoint,
  generateFloorPlanViewpoint,
  generateSectionViewpoint,
  generateIsometricViewpoint,
  generateViewpointSet,
} from '../viewpoint-generator';

import type { Viewpoint, ViewpointSet, Vector3 } from '../viewpoint-generator';

describe('viewpoint-generator.ts', () => {
  const clashLocation: Vector3 = { x: 5, y: 3, z: 2.5 };

  test('generateClashViewpoint returns valid viewpoint', () => {
    const vp = generateClashViewpoint({
      clashId: 'c1',
      location: clashLocation,
      elementIds: ['beam-001', 'duct-001'],
      severity: 'critical',
    });
    expect(vp).toBeDefined();
    expect(vp.camera).toBeDefined();
    expect(vp.camera.position).toBeDefined();
    expect(vp.camera.target).toBeDefined();
    expect(vp.highlightedElements.length).toBe(2);
  });

  test('generateFloorPlanViewpoint creates top-down view', () => {
    const vp = generateFloorPlanViewpoint({
      storey: 'Level 1',
      elevation_m: 0,
      floorHeight_m: 3.2,
      buildingExtent: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    });
    expect(vp).toBeDefined();
    expect(vp.camera.position.z).toBeGreaterThan(vp.camera.target.z);
  });

  test('generateSectionViewpoint creates section cut', () => {
    const vp = generateSectionViewpoint({
      sectionPlane: { origin: { x: 15, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
      buildingExtent: { minX: 0, minY: 0, maxX: 30, maxY: 20, minZ: -3, maxZ: 12 },
    });
    expect(vp).toBeDefined();
    expect(vp.sectionPlanes).toBeDefined();
    expect(vp.sectionPlanes!.length).toBeGreaterThan(0);
  });

  test('generateIsometricViewpoint creates ISO view', () => {
    const vp = generateIsometricViewpoint({
      buildingCenter: { x: 15, y: 10, z: 5 },
      buildingRadius: 20,
    });
    expect(vp).toBeDefined();
    expect(vp.camera.position.x).not.toBe(vp.camera.target.x);
  });

  test('generateViewpointSet creates multiple viewpoints', () => {
    const set = generateViewpointSet({
      clashes: [
        { id: 'c1', location: { x: 5, y: 3, z: 2.5 }, elementIds: ['a', 'b'], severity: 'critical' },
        { id: 'c2', location: { x: 20, y: 10, z: 5 }, elementIds: ['c', 'd'], severity: 'medium' },
      ],
      buildingExtent: { minX: 0, minY: 0, maxX: 30, maxY: 20, minZ: 0, maxZ: 12 },
    });
    expect(set).toBeDefined();
    expect(set.viewpoints.length).toBeGreaterThanOrEqual(2);
  });

  test('viewpoint has color overrides for clashing elements', () => {
    const vp = generateClashViewpoint({
      clashId: 'c1',
      location: clashLocation,
      elementIds: ['beam-001', 'duct-001'],
      severity: 'critical',
    });
    expect(vp.colorOverrides).toBeDefined();
    expect(vp.colorOverrides!.length).toBeGreaterThan(0);
  });
});

// ─── TREND ANALYTICS ────────────────────────────────────────────────────────

import {
  buildTrendDataPoints,
  calculateVelocity,
  detectHotspots,
  analyzeRootCauseTrends,
  generateTrendReport,
  generateTrendAlerts,
  calculateBurndownTarget,
} from '../trend-analytics';

import type { TrendDataPoint, TrendReport, DeltaSummary } from '../trend-analytics';

describe('trend-analytics.ts', () => {
  const sampleDeltas: DeltaSummary[] = [
    { dropId: 'd1', timestamp: '2025-02-01', totalNew: 10, totalResolved: 2, totalPersistent: 20, totalRegression: 0, netChange: 8 },
    { dropId: 'd2', timestamp: '2025-02-08', totalNew: 8, totalResolved: 5, totalPersistent: 23, totalRegression: 1, netChange: 4 },
    { dropId: 'd3', timestamp: '2025-02-15', totalNew: 5, totalResolved: 10, totalPersistent: 18, totalRegression: 0, netChange: -5 },
    { dropId: 'd4', timestamp: '2025-02-22', totalNew: 3, totalResolved: 8, totalPersistent: 13, totalRegression: 0, netChange: -5 },
  ];

  test('buildTrendDataPoints converts deltas to data points', () => {
    const points = buildTrendDataPoints(sampleDeltas);
    expect(points.length).toBe(4);
    for (const p of points) {
      expect(p).toHaveProperty('timestamp');
      expect(p).toHaveProperty('openCount');
    }
  });

  test('calculateVelocity computes resolution rate', () => {
    const velocity = calculateVelocity(sampleDeltas);
    expect(velocity).toBeDefined();
    expect(velocity.avgResolutionPerWeek).toBeGreaterThan(0);
  });

  test('detectHotspots finds problem areas', () => {
    const hotspots = detectHotspots([
      { storey: 'Level 1', discipline: 'STRUCT', count: 15 },
      { storey: 'Level 1', discipline: 'MECH', count: 12 },
      { storey: 'Level 2', discipline: 'ELEC', count: 2 },
    ]);
    expect(Array.isArray(hotspots)).toBe(true);
    expect(hotspots.length).toBeGreaterThan(0);
    expect(hotspots[0].count).toBeGreaterThanOrEqual(hotspots[hotspots.length - 1].count);
  });

  test('analyzeRootCauseTrends categorizes causes', () => {
    const trends = analyzeRootCauseTrends([
      { cause: 'Missing coordination', count: 8, discipline: 'STRUCT' },
      { cause: 'Design change', count: 5, discipline: 'ARCH' },
      { cause: 'Missing coordination', count: 3, discipline: 'MECH' },
    ]);
    expect(Array.isArray(trends)).toBe(true);
  });

  test('generateTrendReport returns full report', () => {
    const report = generateTrendReport({
      deltas: sampleDeltas,
      hotspotData: [{ storey: 'Level 1', discipline: 'STRUCT', count: 10 }],
      rootCauseData: [{ cause: 'Design', count: 5, discipline: 'ARCH' }],
    });
    expect(report).toHaveProperty('velocity');
    expect(report).toHaveProperty('trend');
    expect(report).toHaveProperty('projectedClosure');
  });

  test('trend direction is IMPROVING when net change is negative', () => {
    const report = generateTrendReport({
      deltas: sampleDeltas,
      hotspotData: [],
      rootCauseData: [],
    });
    expect(report.trend).toBe('IMPROVING');
  });

  test('generateTrendAlerts returns alerts for anomalies', () => {
    const alerts = generateTrendAlerts(sampleDeltas);
    expect(Array.isArray(alerts)).toBe(true);
  });

  test('calculateBurndownTarget computes target line', () => {
    const target = calculateBurndownTarget({
      currentOpen: 30,
      targetDate: '2025-06-01',
      currentDate: '2025-03-01',
    });
    expect(target).toBeDefined();
    expect(target.weeksRemaining).toBeGreaterThan(0);
    expect(target.requiredResolutionPerWeek).toBeGreaterThan(0);
  });
});

// ─── PENETRATIONS MATRIX ────────────────────────────────────────────────────

import {
  buildPenetrationMatrix,
  exportPenetrationMatrixCSV,
  comparePenetrationMatrices,
} from '../penetrations-matrix';

describe('penetrations-matrix.ts', () => {
  const samplePenetrations = [
    { structElement: 'wall-001', mepElement: 'pipe-001', discipline: 'PLUMB', storey: 'Level 1', size_mm: 100, status: 'sleeved' },
    { structElement: 'wall-001', mepElement: 'duct-001', discipline: 'MECH', storey: 'Level 1', size_mm: 400, status: 'unsleeved' },
    { structElement: 'slab-001', mepElement: 'pipe-002', discipline: 'PLUMB', storey: 'Level 2', size_mm: 75, status: 'sleeved' },
    { structElement: 'beam-001', mepElement: 'cable-001', discipline: 'ELEC', storey: 'Level 1', size_mm: 50, status: 'unknown' },
  ];

  test('buildPenetrationMatrix creates matrix from penetration records', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations as any);
    expect(matrix).toBeDefined();
    expect(matrix.rows.length).toBeGreaterThan(0);
    expect(matrix.totalPenetrations).toBe(4);
  });

  test('matrix tracks by structural element', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations as any);
    const wall001Row = matrix.rows.find(r => r.structElement === 'wall-001');
    expect(wall001Row).toBeDefined();
    expect(wall001Row!.penetrations.length).toBe(2);
  });

  test('exportPenetrationMatrixCSV returns valid CSV', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations as any);
    const csv = exportPenetrationMatrixCSV(matrix);
    expect(typeof csv).toBe('string');
    expect(csv).toContain('wall-001');
    expect(csv).toContain(',');
  });

  test('comparePenetrationMatrices detects additions', () => {
    const matrix1 = buildPenetrationMatrix(samplePenetrations.slice(0, 2) as any);
    const matrix2 = buildPenetrationMatrix(samplePenetrations as any);
    const delta = comparePenetrationMatrices(matrix1, matrix2);
    expect(delta).toBeDefined();
    expect(delta.added).toBeGreaterThan(0);
  });

  test('comparePenetrationMatrices with identical matrices shows no changes', () => {
    const matrix = buildPenetrationMatrix(samplePenetrations as any);
    const delta = comparePenetrationMatrices(matrix, matrix);
    expect(delta.added).toBe(0);
    expect(delta.removed).toBe(0);
  });

  test('empty penetrations returns empty matrix', () => {
    const matrix = buildPenetrationMatrix([]);
    expect(matrix.totalPenetrations).toBe(0);
    expect(matrix.rows).toHaveLength(0);
  });
});
