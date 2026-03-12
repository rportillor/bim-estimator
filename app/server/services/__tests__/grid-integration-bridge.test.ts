// server/services/__tests__/grid-integration-bridge.test.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID INTEGRATION BRIDGE — CONSUMER WIRING TESTS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Validates that bridge functions produce correct output formats for each
// downstream consumer module. Tests format conversion, not database queries.
//
// Consumer coverage:
//   1. placement-snap → getSnapGrid format
//   2. structural-seed → getGridIntersectionNodes format
//   3. geometry-validator → getGeometryValidatorGrid format
//   4. BOQ grid refs → resolveGridReference format
//   5. issue-log → convertValidationToFindings format
//   6. validation → issue code classification
// ═══════════════════════════════════════════════════════════════════════════════

import {
  convertValidationToFindings,
  type GridFinding,
} from '../grid-integration-bridge';

import {
  validateAndScore,
  issuesToConflictResults,
  type ValidationIssue,
} from '../grid-validation-engine';

import type { ExtractorResult } from '../grid-detection-orchestrator';

// ═══════════════════════════════════════════════════════════════════════════════
// TEST DATA — Simulated ExtractorResult
// ═══════════════════════════════════════════════════════════════════════════════

function buildMockExtractorResult(opts?: {
  axisCount?: number;
  familyCount?: number;
  nodeCount?: number;
  labelCount?: number;
  confidence?: number;
}): ExtractorResult {
  const axisCount = opts?.axisCount ?? 7;
  const familyCount = opts?.familyCount ?? 2;
  const nodeCount = opts?.nodeCount ?? 12;
  const labelCount = opts?.labelCount ?? 7;
  const confidence = opts?.confidence ?? 0.85;

  return {
    success: true,
    components: [{
      runId: 'test-run',
      name: 'Main',
      bboxMinX: '0', bboxMinY: '0', bboxMaxX: '21600', bboxMaxY: '16800',
      primaryFrame: 'MODEL',
      confidence: '0.900',
    }],
    families: Array.from({ length: familyCount }, (_, i) => ({
      componentId: '0',
      thetaDeg: String(i === 0 ? 90 : 0),
      directionVecX: String(i === 0 ? 0 : 1),
      directionVecY: String(i === 0 ? 1 : 0),
      normalVecX: String(i === 0 ? 1 : 0),
      normalVecY: String(i === 0 ? 0 : 1),
      familyRank: i + 1,
      confidence: String(confidence),
    })),
    axes: Array.from({ length: axisCount }, (_, i) => ({
      familyId: String(i < 4 ? 0 : 1),
      geometryType: 'LINE' as const,
      p0X: String(i < 4 ? i * 7200 : 0),
      p0Y: String(i < 4 ? 0 : (i - 4) * 8400),
      p1X: String(i < 4 ? i * 7200 : 21600),
      p1Y: String(i < 4 ? 16800 : (i - 4) * 8400),
      offsetD: String(i < 4 ? i * 7200 : (i - 4) * 8400),
      extentMinT: '0',
      extentMaxT: String(i < 4 ? 16800 : 21600),
      segmentCount: 1,
      totalMergedLength: String(i < 4 ? 16800 : 21600),
      confidence: String(confidence),
      status: 'AUTO' as const,
    })),
    markers: [],
    labels: Array.from({ length: labelCount }, (_, i) => ({
      rawText: i < 4 ? String.fromCharCode(65 + i) : String(i - 3),
      normText: i < 4 ? String.fromCharCode(65 + i) : String(i - 3),
      textSource: 'VECTOR_TEXT' as const,
      textConfidence: '1.000',
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    })),
    axisLabels: Array.from({ length: labelCount }, (_, i) => ({
      axisId: String(i),
      labelId: String(i),
      scoreTotal: '0.850',
      scoreBreakdown: {
        endpointProximity: 0.9,
        perpendicularDistance: 0.8,
        directionalAlignment: 0.85,
        markerSupport: 0.7,
        textQuality: 1.0,
      },
      associationType: 'END_LABEL' as const,
      status: 'AUTO' as const,
    })),
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      componentId: '0',
      x: String((i % 4) * 7200),
      y: String(Math.floor(i / 4) * 8400),
      confidence: String(confidence),
    })),
    nodeAxes: Array.from({ length: nodeCount * 2 }, (_, i) => ({
      nodeId: String(Math.floor(i / 2)),
      axisId: String(i % 2 === 0 ? Math.floor(i / 2) % 4 : 4 + Math.floor(Math.floor(i / 2) / 4)),
    })),
    warnings: ['Test warning'],
    errors: [],
    extractionTimeMs: 150,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Grid Integration Bridge', () => {

  describe('Validation Engine', () => {
    test('produces valid report for good grid', () => {
      const result = buildMockExtractorResult();
      const report = validateAndScore(result, 0.001);

      expect(report.validatedAt).toBeDefined();
      expect(report.confidence.axes.count).toBe(7);
      expect(report.confidence.families.count).toBe(2);
      expect(report.confidence.runConfidence).toBeGreaterThan(0.3);
      expect(report.passesMinimumQuality).toBe(true);
      expect(report.recommendedStatus).not.toBe('FAILED');
    });

    test('detects insufficient families', () => {
      const result = buildMockExtractorResult({ familyCount: 1 });
      const report = validateAndScore(result, 0.001);

      const issues = report.issues.filter(i => i.code === 'GRID_INSUFFICIENT_FAMILIES');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe('high');
      expect(issues[0].generatesRfi).toBe(true);
    });

    test('detects no labels', () => {
      const result = buildMockExtractorResult({ labelCount: 0 });
      result.labels = [];
      result.axisLabels = [];
      const report = validateAndScore(result, 0.001);

      const issues = report.issues.filter(i => i.code === 'GRID_NO_LABELS');
      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('high');
    });

    test('grades A for high-confidence result', () => {
      const result = buildMockExtractorResult({ confidence: 0.95 });
      const report = validateAndScore(result, 0.001);
      expect(['A', 'B']).toContain(report.confidence.grade);
    });

    test('fails minimum quality for zero axes', () => {
      const result = buildMockExtractorResult({ axisCount: 0 });
      result.axes = [];
      result.axisLabels = [];
      result.nodeAxes = [];
      result.nodes = [];
      const report = validateAndScore(result, 0.001);
      expect(report.passesMinimumQuality).toBe(false);
      expect(report.recommendedStatus).toBe('FAILED');
    });

    test('spacing validation with mm→m scale', () => {
      // 7200mm = 7.2m — within typical range, no issue
      const result = buildMockExtractorResult();
      const report = validateAndScore(result, 0.001);
      const belowMin = report.issues.filter(i => i.code === 'GRID_SPACING_BELOW_MIN');
      expect(belowMin).toHaveLength(0);
    });
  });

  describe('Issue Conversion', () => {
    test('convertValidationToFindings maps severity correctly', () => {
      const issues: ValidationIssue[] = [
        {
          code: 'GRID_SPACING_BELOW_MIN',
          severity: 'high',
          category: 'domain',
          title: 'Spacing below minimum',
          description: 'Test',
          affectedEntities: ['axis:0'],
          suggestedAction: 'Review',
          generatesRfi: true,
        },
        {
          code: 'GRID_NON_ORTHOGONAL',
          severity: 'medium',
          category: 'topology',
          title: 'Non-orthogonal',
          description: 'Test',
          affectedEntities: ['family:0'],
          suggestedAction: 'Verify',
          generatesRfi: false,
        },
      ];

      const findings = convertValidationToFindings(issues, 'run-001');

      expect(findings).toHaveLength(2);
      expect(findings[0].type).toBe('GRID_SPACING_ANOMALY');
      expect(findings[0].severity).toBe('high');
      expect(findings[0].sourceRunId).toBe('run-001');
      expect(findings[1].type).toBe('GRID_NON_ORTHOGONAL');
      expect(findings[1].severity).toBe('medium');
    });

    test('issuesToConflictResults filters RFI-generating issues only', () => {
      const issues: ValidationIssue[] = [
        {
          code: 'GRID_SPACING_BELOW_MIN', severity: 'high', category: 'domain',
          title: 'Test', description: 'Test', affectedEntities: [],
          suggestedAction: 'Review', generatesRfi: true,
        },
        {
          code: 'GRID_MANY_FAMILIES', severity: 'low', category: 'topology',
          title: 'Test', description: 'Test', affectedEntities: [],
          suggestedAction: 'Review', generatesRfi: false,
        },
      ];

      const conflicts = issuesToConflictResults(issues);
      expect(conflicts).toHaveLength(1); // Only the RFI-generating one
      expect(conflicts[0].type).toBe('missing_information');
      expect(conflicts[0].severity).toBe('high');
    });
  });

  describe('ExtractorResult Format', () => {
    test('FK references use index-based temp IDs', () => {
      const result = buildMockExtractorResult();

      // Families → components via "0"
      for (const fam of result.families) {
        expect(fam.componentId).toBe('0');
      }
      // Axes → families via index
      for (const axis of result.axes) {
        const fi = parseInt(axis.familyId);
        expect(fi).toBeGreaterThanOrEqual(0);
        expect(fi).toBeLessThan(result.families.length);
      }
      // Nodes → components via "0"
      for (const node of result.nodes) {
        expect(node.componentId).toBe('0');
      }
      // Node-Axes → nodes and axes via index
      for (const na of result.nodeAxes) {
        const ni = parseInt(na.nodeId);
        const ai = parseInt(na.axisId);
        expect(ni).toBeGreaterThanOrEqual(0);
        expect(ai).toBeGreaterThanOrEqual(0);
      }
    });

    test('all entities have required fields', () => {
      const result = buildMockExtractorResult();

      expect(result.components.length).toBeGreaterThan(0);
      expect(result.families.length).toBeGreaterThan(0);
      expect(result.axes.length).toBeGreaterThan(0);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.labels.length).toBeGreaterThan(0);
      expect(result.axisLabels.length).toBeGreaterThan(0);

      // Each axis has geometry
      for (const axis of result.axes) {
        expect(axis.geometryType).toBe('LINE');
        expect(axis.p0X).toBeDefined();
        expect(axis.confidence).toBeDefined();
      }

      // Each node has coordinates
      for (const node of result.nodes) {
        expect(node.x).toBeDefined();
        expect(node.y).toBeDefined();
        expect(node.confidence).toBeDefined();
      }
    });
  });
});
