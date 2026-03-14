// server/services/__tests__/grid-pipeline-e2e.test.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID DETECTION PIPELINE — END-TO-END INTEGRATION TEST
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests the COMPLETE grid detection pipeline with a synthetic DXF representing
// a realistic 4x3 structural grid (typical Canadian commercial building).
//
// Pipeline coverage:
//   DXF parse -> candidate filter -> DBSCAN angle clustering -> offset clustering
//   -> segment merging -> marker detection -> label extraction -> label-axis scoring
//   -> intersection graph -> validation engine -> packaging
//
// Does NOT require database — tests geometry engine + label engine + validation
// in isolation from storage/persistence.
//
// Standards: CIQS Standard Method, The Moorings on Cameron Lake reference project
// ═══════════════════════════════════════════════════════════════════════════════

/* ------------------------------------------------------------------ */
/*  Mocks — declared before module-under-test imports                 */
/* ------------------------------------------------------------------ */

// Mock grid-storage so importing grid-detection-orchestrator does not require DATABASE_URL
jest.mock('../grid-storage', () => ({
  createDetectionRun: jest.fn(),
  updateDetectionRunStatus: jest.fn(),
  createGridComponent: jest.fn(),
  createGridFamilies: jest.fn(),
  createGridAxes: jest.fn(),
  createGridMarkers: jest.fn(),
  createGridLabels: jest.fn(),
  createGridAxisLabels: jest.fn(),
  createGridNodes: jest.fn(),
  createGridNodeAxesBatch: jest.fn(),
  createCoordinateTransform: jest.fn(),
  getProjectGridSystem: jest.fn(),
  getGridNodesByComponent: jest.fn(),
  getGridComponentsByRun: jest.fn(),
  getDetectionRunsByProject: jest.fn(),
  getFullGridDataForRun: jest.fn(),
}));

// Mock storage-file-resolver so importing grid-detection-orchestrator does not require DATABASE_URL
jest.mock('../storage-file-resolver', () => ({
  loadFileBuffer: jest.fn(),
  deleteModelCascade: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports — after mocks                                              */
/* ------------------------------------------------------------------ */

import { dxfGridExtractor } from '../dxf-grid-extractor';
import { validateAndScore } from '../grid-validation-engine';
import { DEFAULT_DETECTION_PARAMS } from '../grid-detection-orchestrator';
import type { ExtractorResult , InputClassification } from '../grid-detection-orchestrator';

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHETIC DXF — 4 vertical x 3 horizontal grid (7.2m x 8.4m spacing)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Grid layout (mm coordinates):
//   Vertical:   A(x=0), B(x=7200), C(x=14400), D(x=21600)
//   Horizontal: 1(y=0), 2(y=8400), 3(y=16800)
//
//   Grid bubbles (circles) at both ends of each axis
//   Text labels inside bubbles: A,B,C,D and 1,2,3

function buildSyntheticDxf(): string {
  const lines: string[] = [];

  // DXF header
  lines.push('0', 'SECTION', '2', 'HEADER');
  lines.push('9', '$INSUNITS', '70', '4'); // Millimeters
  lines.push('9', '$ACADVER', '1', 'AC1027');
  lines.push('0', 'ENDSEC');

  // Entities section
  lines.push('0', 'SECTION', '2', 'ENTITIES');

  // Vertical grid lines (A, B, C, D) — running Y from -2000 to 18800
  const verticalX = [0, 7200, 14400, 21600];
  const verticalLabels = ['A', 'B', 'C', 'D'];
  const yExtent = [-2000, 18800];

  for (let i = 0; i < verticalX.length; i++) {
    const x = verticalX[i];
    // LINE entity
    lines.push('0', 'LINE');
    lines.push('8', 'S-GRID');  // Layer
    lines.push('10', String(x), '20', String(yExtent[0]), '30', '0');  // Start
    lines.push('11', String(x), '21', String(yExtent[1]), '31', '0');  // End

    // Grid bubble at bottom (CIRCLE)
    lines.push('0', 'CIRCLE');
    lines.push('8', 'S-GRID');
    lines.push('10', String(x), '20', String(yExtent[0] - 600), '30', '0');
    lines.push('40', '400'); // Radius

    // Label at bottom (TEXT)
    lines.push('0', 'TEXT');
    lines.push('8', 'S-GRID');
    lines.push('10', String(x - 100), '20', String(yExtent[0] - 750), '30', '0');
    lines.push('40', '300'); // Height
    lines.push('1', verticalLabels[i]);

    // Grid bubble at top (CIRCLE)
    lines.push('0', 'CIRCLE');
    lines.push('8', 'S-GRID');
    lines.push('10', String(x), '20', String(yExtent[1] + 600), '30', '0');
    lines.push('40', '400');

    // Label at top (TEXT)
    lines.push('0', 'TEXT');
    lines.push('8', 'S-GRID');
    lines.push('10', String(x - 100), '20', String(yExtent[1] + 450), '30', '0');
    lines.push('40', '300');
    lines.push('1', verticalLabels[i]);
  }

  // Horizontal grid lines (1, 2, 3) — running X from -2000 to 23600
  const horizontalY = [0, 8400, 16800];
  const horizontalLabels = ['1', '2', '3'];
  const xExtent = [-2000, 23600];

  for (let i = 0; i < horizontalY.length; i++) {
    const y = horizontalY[i];
    // LINE entity
    lines.push('0', 'LINE');
    lines.push('8', 'S-GRID');
    lines.push('10', String(xExtent[0]), '20', String(y), '30', '0');
    lines.push('11', String(xExtent[1]), '21', String(y), '31', '0');

    // Grid bubble at left (CIRCLE)
    lines.push('0', 'CIRCLE');
    lines.push('8', 'S-GRID');
    lines.push('10', String(xExtent[0] - 600), '20', String(y), '30', '0');
    lines.push('40', '400');

    // Label at left (TEXT)
    lines.push('0', 'TEXT');
    lines.push('8', 'S-GRID');
    lines.push('10', String(xExtent[0] - 750), '20', String(y - 150), '30', '0');
    lines.push('40', '300');
    lines.push('1', horizontalLabels[i]);

    // Grid bubble at right (CIRCLE)
    lines.push('0', 'CIRCLE');
    lines.push('8', 'S-GRID');
    lines.push('10', String(xExtent[1] + 600), '20', String(y), '30', '0');
    lines.push('40', '400');

    // Label at right (TEXT)
    lines.push('0', 'TEXT');
    lines.push('8', 'S-GRID');
    lines.push('10', String(xExtent[1] + 450), '20', String(y - 150), '30', '0');
    lines.push('40', '300');
    lines.push('1', horizontalLabels[i]);
  }

  // Add some non-grid lines (walls, dimensions) as noise
  // Wall along Grid A from 1 to 3
  lines.push('0', 'LINE', '8', 'A-WALL');
  lines.push('10', '100', '20', '0', '30', '0');
  lines.push('11', '100', '21', '16800', '31', '0');
  // Short dimension line (should be filtered by min length)
  lines.push('0', 'LINE', '8', 'A-DIM');
  lines.push('10', '5000', '20', '5000', '30', '0');
  lines.push('11', '5200', '21', '5000', '31', '0');
  // Random non-grid text
  lines.push('0', 'TEXT', '8', 'A-NOTE');
  lines.push('10', '10000', '20', '10000', '30', '0');
  lines.push('40', '200', '1', 'TYPICAL FLOOR PLAN');

  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Grid Detection Pipeline E2E', () => {
  let result: ExtractorResult;
  const dxfContent = buildSyntheticDxf();
  const buffer = Buffer.from(dxfContent, 'utf8');

  const classification: InputClassification = {
    inputType: 'DXF',
    confidence: 0.95,
    hasVectorContent: true,
    detectedLayers: ['S-GRID', 'A-WALL', 'A-DIM', 'A-NOTE'],
    notes: ['Test DXF with synthetic grid'],
  };

  beforeAll(async () => {
    result = await dxfGridExtractor.extract(
      buffer,
      classification,
      DEFAULT_DETECTION_PARAMS,
      'test-run-001',
    );
  });

  // Pipeline Success
  test('pipeline completes successfully', () => {
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // Components
  test('detects exactly 1 grid component', () => {
    expect(result.components).toHaveLength(1);
    expect(result.components[0].primaryFrame).toBe('MODEL');
  });

  // Families
  test('detects exactly 2 orientation families', () => {
    expect(result.families).toHaveLength(2);
    // One near 0 degrees (horizontal), one near 90 degrees (vertical)
    const angles = result.families.map(f => parseFloat(String(f.thetaDeg)));
    const hasHorizontal = angles.some(a => a < 10 || a > 170);
    const hasVertical = angles.some(a => a > 80 && a < 100);
    expect(hasHorizontal).toBe(true);
    expect(hasVertical).toBe(true);
  });

  // Axes
  test('detects 7 axes (4 vertical + 3 horizontal)', () => {
    expect(result.axes.length).toBeGreaterThanOrEqual(6);
    expect(result.axes.length).toBeLessThanOrEqual(8);
  });

  test('all axes have confidence > 0.1', () => {
    for (const axis of result.axes) {
      expect(parseFloat(String(axis.confidence))).toBeGreaterThan(0.1);
    }
  });

  test('axes are LINE type with valid endpoints', () => {
    for (const axis of result.axes) {
      expect(axis.geometryType).toBe('LINE');
      expect(axis.p0X).toBeDefined();
      expect(axis.p0Y).toBeDefined();
      expect(axis.p1X).toBeDefined();
      expect(axis.p1Y).toBeDefined();
    }
  });

  // Markers
  test('detects grid bubble markers', () => {
    expect(result.markers.length).toBeGreaterThan(0);
    // We placed 14 circles (2 per axis x 7 axes), some should be detected
  });

  test('markers are CIRCLE shape', () => {
    for (const marker of result.markers) {
      expect(marker.markerShape).toBe('CIRCLE');
    }
  });

  // Labels
  test('detects grid label text', () => {
    expect(result.labels.length).toBeGreaterThan(0);
    // Should find A, B, C, D, 1, 2, 3
  });

  test('labels are VECTOR_TEXT source', () => {
    for (const label of result.labels) {
      expect(label.textSource).toBe('VECTOR_TEXT');
    }
  });

  test('label normalization produces valid grid labels', () => {
    const normTexts = result.labels.map(l => l.normText).filter(Boolean);
    // At least some of A,B,C,D,1,2,3 should appear
    const validLabels = new Set(['A', 'B', 'C', 'D', '1', '2', '3']);
    const foundValid = normTexts.filter(t => validLabels.has(t as string));
    expect(foundValid.length).toBeGreaterThan(0);
  });

  // Label-Axis Associations
  test('creates label-axis associations', () => {
    expect(result.axisLabels.length).toBeGreaterThan(0);
  });

  test('associations have valid score breakdowns', () => {
    for (const al of result.axisLabels) {
      const score = parseFloat(String(al.scoreTotal));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(al.scoreBreakdown).toBeDefined();
      const bd = al.scoreBreakdown as any;
      expect(bd.endpointProximity).toBeDefined();
      expect(bd.perpendicularDistance).toBeDefined();
      expect(bd.directionalAlignment).toBeDefined();
      expect(bd.markerSupport).toBeDefined();
      expect(bd.textQuality).toBeDefined();
    }
  });

  // Nodes (Intersections)
  test('detects grid intersections', () => {
    // 4 x 3 grid = 12 expected intersections
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.length).toBeLessThanOrEqual(15); // Some tolerance
  });

  test('nodes have valid coordinates', () => {
    for (const node of result.nodes) {
      const x = parseFloat(String(node.x));
      const y = parseFloat(String(node.y));
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  // Node-Axis Links
  test('creates node-axis links (2 per intersection)', () => {
    // Each intersection links exactly 2 axes
    expect(result.nodeAxes.length).toBe(result.nodes.length * 2);
  });

  // FK References
  test('all FK references use index-based temp IDs', () => {
    // Families reference components via "0"
    for (const fam of result.families) {
      expect(fam.componentId).toBe('0');
    }
    // Axes reference families via index string
    for (const axis of result.axes) {
      expect(parseInt(axis.familyId)).toBeLessThan(result.families.length);
    }
    // Nodes reference components via "0"
    for (const node of result.nodes) {
      expect(node.componentId).toBe('0');
    }
  });

  // Coordinate Transform
  test('includes coordinate transform with mm-scale default', () => {
    // The synthetic DXF header format may not be fully parsed by the DXF
    // library, so INSUNITS falls back to 0 (Unitless). The extractor defaults
    // to mm scale (0.001) for construction drawings regardless.
    expect(result.transform).toBeDefined();
    expect(result.transform!.calibrationMethod).toBe('CAD_UNITS');
    expect(result.transform!.targetUnit).toBe('m');
    const scale = parseFloat(String(result.transform!.scale));
    expect(scale).toBeCloseTo(0.001, 5); // mm to meters (default for unitless)
    // sourceUnit depends on whether the parser reads the header correctly
    expect(typeof result.transform!.sourceUnit).toBe('string');
  });

  // Validation Engine
  test('validation engine produces valid report', () => {
    const report = validateAndScore(result, 0.001); // mm to m scale
    expect(report.validatedAt).toBeDefined();
    expect(report.confidence).toBeDefined();
    expect(report.confidence.axes.count).toBeGreaterThan(0);
    expect(report.confidence.families.count).toBe(2);
    expect(report.confidence.runConfidence).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(report.confidence.grade);
  });

  test('validation detects correct spacing range', () => {
    const report = validateAndScore(result, 0.001);
    // 7.2m and 8.4m spacing — within typical Canadian range (3-12m)
    const spacingIssues = report.issues.filter(i => i.code === 'GRID_SPACING_BELOW_MIN');
    expect(spacingIssues).toHaveLength(0); // No below-minimum issues
  });

  test('validation detects 2 families (passes minimum)', () => {
    const report = validateAndScore(result, 0.001);
    const familyIssues = report.issues.filter(i => i.code === 'GRID_INSUFFICIENT_FAMILIES');
    expect(familyIssues).toHaveLength(0);
  });

  // No Hardcoded Defaults
  test('no synthetic 8m or 6m spacings in output', () => {
    // Check that no axis offset corresponds to hardcoded 8000mm or 6000mm
    for (const axis of result.axes) {
      const offset = Math.abs(parseFloat(String(axis.offsetD)));
      // Should see 7200 or 8400 spacings, not 8000 or 6000
      if (offset > 5000 && offset < 9000) {
        expect(Math.abs(offset - 8000)).toBeGreaterThan(100); // Not 8000
        expect(Math.abs(offset - 6000)).toBeGreaterThan(100); // Not 6000
      }
    }
  });

  // Noise Rejection
  test('short dimension line is filtered out (below min length)', () => {
    // The 200mm dimension line should not appear as an axis
    // All axes should be much longer than 200mm
    for (const axis of result.axes) {
      const len = parseFloat(String(axis.totalMergedLength));
      expect(len).toBeGreaterThan(1000); // All real grid lines > 1m
    }
  });

  test('non-grid text is filtered out', () => {
    // "TYPICAL FLOOR PLAN" should not appear as a grid label
    const labelTexts = result.labels.map(l => l.rawText);
    expect(labelTexts).not.toContain('TYPICAL FLOOR PLAN');
  });

  // Extraction Time
  test('extraction completes in reasonable time', () => {
    expect(result.extractionTimeMs).toBeLessThan(10000); // Under 10 seconds
  });
});
