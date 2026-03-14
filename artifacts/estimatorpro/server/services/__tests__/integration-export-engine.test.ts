/**
 * Integration & Export Engine — Jest Test Suite
 * SOP Part 8
 */

// Mock storage (imported transitively by report-generator)
jest.mock('../../storage', () => ({
  storage: {},
}));

import {
  convertToIFCElements,
  generateIFC4File,
  generateMSProjectXML,
  buildBOQExportSheets,
  sheetsToSpreadsheetML,
  sheetToCSV,
  exportBOQtoCSV,
  exportDivisionSummaryCSV,
  exportTradePackageCSV,
  exportBidLevelingCSV,
  exportClashReportCSV,
  exportGapRegisterCSV,
  exportReportJSON,
  type IFCExportElement,
  type XLSXSheet,
} from '../integration-export-engine';

import {
  generateBOQReport,
  generateBidLevelingSheet,
  generateClashReport,
  generateGapRegister,
  generateScheduleOfValues,
  type ScheduleOfValues,
} from '../report-generator';


// ══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ══════════════════════════════════════════════════════════════════════════════

const SAMPLE_BIM_ELEMENTS = [
  { id: 'wall-001', type: 'wall', name: 'Exterior Wall', storey: 'Level 1', properties: { width: 0.2, depth: 6.0, height: 3.0, material: '200mm CMU', x: 0, y: 0, z: 0, fireRating: '2hr' } },
  { id: 'wall-002', type: 'wall', name: 'Interior Partition', storey: 'Level 1', properties: { width: 0.1, depth: 4.0, height: 3.0, material: 'Drywall', x: 5, y: 0, z: 0 } },
  { id: 'slab-001', type: 'slab', name: 'Floor Slab L1', storey: 'Level 1', properties: { width: 12, depth: 15, height: 0.2, material: '30MPa Concrete', x: 0, y: 0, z: 0, area: 180 } },
  { id: 'slab-002', type: 'slab', name: 'Floor Slab L2', storey: 'Level 2', properties: { width: 12, depth: 15, height: 0.2, material: '30MPa Concrete', x: 0, y: 0, z: 3 } },
  { id: 'col-001', type: 'column', name: 'Column C1', storey: 'Level 1', properties: { width: 0.4, depth: 0.4, height: 3.0, material: '40MPa Concrete', x: 0, y: 0, z: 0 } },
  { id: 'beam-001', type: 'beam', name: 'Beam B1', storey: 'Level 1', properties: { width: 0.3, depth: 0.5, height: 6.0, material: '35MPa Concrete', x: 0, y: 0, z: 2.5 } },
  { id: 'door-001', type: 'door', name: 'Door D101', storey: 'Level 1', properties: { width: 0.9, depth: 0.05, height: 2.1, x: 2, y: 0, z: 0 } },
  { id: 'win-001', type: 'window', name: 'Window W101', storey: 'Level 1', properties: { width: 1.2, depth: 0.1, height: 1.5, x: 4, y: 0, z: 0.9, uValue: 1.4 } },
  { id: 'roof-001', type: 'roof', name: 'Main Roof', storey: 'Roof', properties: { width: 12, depth: 15, height: 0.3, x: 0, y: 0, z: 6, material: 'SBS Modified Bitumen' } },
  { id: 'duct-001', type: 'duct', name: 'Supply Duct', storey: 'Level 1', properties: { width: 0.4, depth: 0.3, height: 8.0, x: 1, y: 1, z: 2.7 } },
  { id: 'pipe-001', type: 'pipe', name: 'Cold Water', storey: 'Level 1', properties: { width: 0.05, depth: 0.05, height: 5.0, x: 3, y: 2, z: 0 } },
  { id: 'light-001', type: 'light', name: 'LED Panel', storey: 'Level 1', properties: { width: 0.6, depth: 0.6, height: 0.1, x: 5, y: 5, z: 2.9 } },
];

const SAMPLE_ESTIMATE_LINES = [
  { code: '033000-SLAB-CONC', description: 'Concrete slab', unit: 'm\u00B3', qty: 45.6, rate: 285, elementIds: ['slab-001'], evidenceRefs: ['A-101#p1'], storey: 'Level 1' },
  { code: '033000-COL-CONC', description: 'Concrete column', unit: 'm\u00B3', qty: 8.4, rate: 310, elementIds: ['col-001'], evidenceRefs: ['S-201#p3'], storey: 'Level 1' },
  { code: '054000-REBAR', description: 'Reinforcing steel', unit: 'kg', qty: 12500, rate: 2.85, elementIds: ['rebar-001'], evidenceRefs: ['S-301#p1'], storey: 'Level 1' },
  { code: '081100-DOOR', description: 'Interior doors', unit: 'ea', qty: 24, rate: 850, elementIds: ['door-001'], evidenceRefs: ['A-401#p1'], storey: 'Level 1' },
  { code: '085100-WINDOW', description: 'Windows', unit: 'ea', qty: 18, rate: 1200, elementIds: ['win-001'], evidenceRefs: ['A-401#p2'], storey: 'Level 1' },
  { code: '092900-DRYWALL', description: 'Gypsum board', unit: 'm\u00B2', qty: 890, rate: 38, elementIds: ['wall-001'], evidenceRefs: ['A-201#p3'], storey: 'Level 1' },
  { code: '260519-LIGHT', description: 'Light fixtures', unit: 'ea', qty: 48, rate: 320, elementIds: ['light-001'], evidenceRefs: ['E-101#p1'], storey: 'Level 1' },
  { code: '033000-SLAB-CONC', description: 'Concrete slab L2', unit: 'm\u00B3', qty: 42, rate: 285, elementIds: ['slab-002'], evidenceRefs: ['A-102#p1'], storey: 'Level 2' },
];

const DEFAULT_OHP = { overhead: 0.10, profit: 0.08, contingency: 0.10 };
const PROJECT_ID = 'proj-export-001';
const PROJECT_NAME = 'The Moorings on Cameron Lake';

// Pre-generate reports for export tests
let BOQ_REPORT: ReturnType<typeof generateBOQReport>;
let BID_SHEET: ReturnType<typeof generateBidLevelingSheet>;
let CLASH_REPORT: ReturnType<typeof generateClashReport>;
let GAP_REGISTER: ReturnType<typeof generateGapRegister>;
let SOV: ReturnType<typeof generateScheduleOfValues>;

beforeAll(() => {
  BOQ_REPORT = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);
  BID_SHEET = generateBidLevelingSheet(BOQ_REPORT, PROJECT_NAME);
  CLASH_REPORT = generateClashReport(PROJECT_ID, {
    clashes: [
      { clashId: 'C1', severity: 'CRITICAL', category: 'HARD_CLASH', elementAId: 'duct-001', elementBId: 'beam-001', location: 'Grid B-3', storey: 'Level 1', penetrationDepth_mm: 120, description: 'Duct hits beam' },
      { clashId: 'C2', severity: 'MEDIUM', category: 'CLEARANCE', elementAId: 'pipe-001', elementBId: 'duct-001', location: 'Grid C-4', storey: 'Level 1', penetrationDepth_mm: 30, description: 'Pipe clearance issue' },
    ],
  }, PROJECT_NAME);
  GAP_REGISTER = generateGapRegister(PROJECT_ID, PROJECT_NAME, [
    { id: 'G1', type: 'missing_dimension', parameterName: 'wall_height', description: 'Wall height missing', discipline: 'Architectural', impact: 'critical', affectedCount: 12, sopReference: 'SOP 6.3', evidenceRef: { documentId: 'A-201' } },
    { id: 'G2', type: 'missing_spec', parameterName: 'insulation', description: 'R-value not specified', discipline: 'Architectural', impact: 'high', affectedCount: 8, sopReference: 'SOP 4', evidenceRef: null },
  ] as any);
  SOV = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, BOQ_REPORT, null);
});


// ══════════════════════════════════════════════════════════════════════════════
//  1. IFC4 EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('IFC4 STEP Export', () => {
  let ifcElements: IFCExportElement[];
  let ifcFile: string;

  beforeAll(() => {
    ifcElements = convertToIFCElements(SAMPLE_BIM_ELEMENTS);
    ifcFile = generateIFC4File(ifcElements, PROJECT_NAME, 'Test Author');
  });

  test('converts BIM elements to IFC format', () => {
    expect(ifcElements.length).toBe(SAMPLE_BIM_ELEMENTS.length);
  });

  test('maps wall elements to IfcWall', () => {
    const walls = ifcElements.filter(e => e.ifcType === 'IfcWall');
    expect(walls.length).toBe(2);
  });

  test('maps slab elements to IfcSlab', () => {
    const slabs = ifcElements.filter(e => e.ifcType === 'IfcSlab');
    expect(slabs.length).toBe(2);
  });

  test('maps column to IfcColumn', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcColumn')).toBeTruthy();
  });

  test('maps beam to IfcBeam', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcBeam')).toBeTruthy();
  });

  test('maps door to IfcDoor', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcDoor')).toBeTruthy();
  });

  test('maps window to IfcWindow', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcWindow')).toBeTruthy();
  });

  test('maps roof to IfcRoof', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcRoof')).toBeTruthy();
  });

  test('maps duct to IfcDuctSegment', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcDuctSegment')).toBeTruthy();
  });

  test('maps pipe to IfcPipeSegment', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcPipeSegment')).toBeTruthy();
  });

  test('maps light to IfcLightFixture', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcLightFixture')).toBeTruthy();
  });

  test('preserves geometry', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.geometry.width).toBe(0.2);
    expect(wall.geometry.depth).toBe(6.0);
    expect(wall.geometry.height).toBe(3.0);
  });

  test('preserves material name', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.materialName).toBe('200mm CMU');
  });

  test('preserves custom properties', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.properties.fireRating).toBe('2hr');
  });

  test('generates valid IFC4 header', () => {
    expect(ifcFile).toContain('ISO-10303-21;');
    expect(ifcFile).toContain("FILE_SCHEMA(('IFC4'));");
  });

  test('includes project name in header', () => {
    expect(ifcFile).toContain(PROJECT_NAME);
  });

  test('includes ENDSEC and END-ISO-10303-21', () => {
    expect(ifcFile).toContain('ENDSEC;');
    expect(ifcFile).toContain('END-ISO-10303-21;');
  });

  test('includes DATA section', () => {
    expect(ifcFile).toContain('DATA;');
  });

  test('includes IFCPROJECT entity', () => {
    expect(ifcFile).toContain('IFCPROJECT');
  });

  test('includes IFCSITE entity', () => {
    expect(ifcFile).toContain('IFCSITE');
  });

  test('includes IFCBUILDING entity', () => {
    expect(ifcFile).toContain('IFCBUILDING');
  });

  test('includes IFCBUILDINGSTOREY entities', () => {
    expect(ifcFile).toContain('IFCBUILDINGSTOREY');
  });

  test('includes element entities (IFCWALL etc)', () => {
    expect(ifcFile).toContain('IFCWALL');
    expect(ifcFile).toContain('IFCSLAB');
    expect(ifcFile).toContain('IFCCOLUMN');
    expect(ifcFile).toContain('IFCDOOR');
  });

  test('includes spatial containment', () => {
    expect(ifcFile).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE');
  });

  test('includes aggregation relationships', () => {
    expect(ifcFile).toContain('IFCRELAGGREGATES');
  });

  test('includes property sets', () => {
    expect(ifcFile).toContain('IFCPROPERTYSET');
    expect(ifcFile).toContain('EstimatorPro_Properties');
  });

  test('includes SI units (metre)', () => {
    expect(ifcFile).toContain('IFCSIUNIT');
    expect(ifcFile).toContain('.METRE.');
  });

  test('includes bounding box geometry', () => {
    expect(ifcFile).toContain('IFCBOUNDINGBOX');
    expect(ifcFile).toContain('IFCSHAPEREPRESENTATION');
  });

  test('handles empty elements array', () => {
    const empty = generateIFC4File([], 'Empty Project');
    expect(empty).toContain('ISO-10303-21;');
    expect(empty).toContain('END-ISO-10303-21;');
    expect(empty).toContain('IFCPROJECT');
  });

  test('generates substantial file size', () => {
    expect(ifcFile.length).toBeGreaterThan(2000);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  2. MS PROJECT XML TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('MS Project XML Export', () => {
  let xml: string;

  beforeAll(() => {
    xml = generateMSProjectXML(SOV, PROJECT_NAME, '2025-04-01');
  });

  test('generates valid XML header', () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Project xmlns=');
  });

  test('includes project name', () => {
    expect(xml).toContain(PROJECT_NAME);
  });

  test('includes CAD currency', () => {
    expect(xml).toContain('<CurrencyCode>CAD</CurrencyCode>');
  });

  test('includes calendar', () => {
    expect(xml).toContain('<Calendar>');
    expect(xml).toContain('Standard');
  });

  test('includes tasks for each phase', () => {
    expect(xml).toContain('<Tasks>');
    expect(xml).toContain('Mobilization');
    expect(xml).toContain('Commissioning');
  });

  test('includes summary task UID 0', () => {
    expect(xml).toContain('<UID>0</UID>');
  });

  test('includes task durations', () => {
    expect(xml).toContain('<Duration>PT');
  });

  test('includes milestones', () => {
    expect(xml).toContain('<Milestone>1</Milestone>');
  });

  test('includes task costs', () => {
    expect(xml).toContain('<Cost>');
  });

  test('includes start date', () => {
    expect(xml).toContain('2025-04-01');
  });

  test('includes weekday definitions', () => {
    expect(xml).toContain('<WeekDay>');
    expect(xml).toContain('<DayWorking>');
  });

  test('closes XML properly', () => {
    expect(xml).toContain('</Project>');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  3. SPREADSHEETML EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('SpreadsheetML XLSX Export', () => {
  let sheets: XLSXSheet[];
  let xml: string;

  beforeAll(() => {
    sheets = buildBOQExportSheets(BOQ_REPORT);
    xml = sheetsToSpreadsheetML(sheets, PROJECT_NAME);
  });

  test('generates 6 sheets', () => {
    expect(sheets.length).toBe(6);
  });

  test('sheet 1 is Executive Summary', () => {
    expect(sheets[0].name).toBe('Executive Summary');
  });

  test('sheet 2 is BOQ Detail', () => {
    expect(sheets[1].name).toBe('BOQ Detail');
  });

  test('sheet 3 is Division Summary', () => {
    expect(sheets[2].name).toBe('Division Summary');
  });

  test('sheet 4 is Storey Summary', () => {
    expect(sheets[3].name).toBe('Storey Summary');
  });

  test('sheet 5 is Trade Packages', () => {
    expect(sheets[4].name).toBe('Trade Packages');
  });

  test('sheet 6 is Confidence Analysis', () => {
    expect(sheets[5].name).toBe('Confidence Analysis');
  });

  test('BOQ Detail has correct column count', () => {
    expect(sheets[1].headers.length).toBe(17);
  });

  test('BOQ Detail rows match report lines', () => {
    expect(sheets[1].rows.length).toBe(BOQ_REPORT.lines.length);
  });

  test('Division Summary has rows for each division', () => {
    // +1 for total row
    expect(sheets[2].rows.length).toBe(BOQ_REPORT.divisionSubtotals.length + 1);
  });

  test('Executive Summary includes total project cost', () => {
    const totalRow = sheets[0].rows.find(r => r[0] === 'TOTAL PROJECT COST');
    expect(totalRow).toBeTruthy();
  });

  test('generates valid SpreadsheetML', () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Workbook');
    expect(xml).toContain('</Workbook>');
  });

  test('includes all worksheet names', () => {
    for (const sheet of sheets) {
      expect(xml).toContain(sheet.name);
    }
  });

  test('includes styles', () => {
    expect(xml).toContain('<Styles>');
    expect(xml).toContain('Header');
    expect(xml).toContain('Money');
    expect(xml).toContain('TotalRow');
    expect(xml).toContain('GapRow');
  });

  test('includes document properties', () => {
    expect(xml).toContain('<DocumentProperties');
    expect(xml).toContain('EstimatorPro v3');
  });

  test('includes column widths', () => {
    expect(xml).toContain('<Column ss:Width=');
  });

  test('includes data cells', () => {
    expect(xml).toContain('<Data ss:Type="Number">');
    expect(xml).toContain('<Data ss:Type="String">');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  4. CSV EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('CSV Exports', () => {
  test('BOQ CSV has header row', () => {
    const boqCsv = exportBOQtoCSV(BOQ_REPORT);
    const firstLine = boqCsv.split('\n')[0];
    expect(firstLine).toContain('Line No');
    expect(firstLine).toContain('CSI Division');
    expect(firstLine).toContain('Total Cost');
  });

  test('BOQ CSV has correct row count', () => {
    const boqCsv = exportBOQtoCSV(BOQ_REPORT);
    const lines = boqCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(BOQ_REPORT.lines.length + 1); // +1 for header
  });

  test('Division CSV has header', () => {
    const divCsv = exportDivisionSummaryCSV(BOQ_REPORT);
    expect(divCsv.split('\n')[0]).toContain('Division');
  });

  test('Division CSV has rows', () => {
    const divCsv = exportDivisionSummaryCSV(BOQ_REPORT);
    expect(divCsv.split('\n').length).toBeGreaterThan(1);
  });

  test('Trade CSV has header', () => {
    const tradeCsv = exportTradePackageCSV(BOQ_REPORT);
    expect(tradeCsv.split('\n')[0]).toContain('Trade Package');
  });

  test('Bid-leveling CSV has header', () => {
    const bidCsv = exportBidLevelingCSV(BID_SHEET);
    expect(bidCsv.split('\n')[0]).toContain('Trade Package');
    expect(bidCsv.split('\n')[0]).toContain('Base Amount');
  });

  test('Bid-leveling CSV has rows for each trade', () => {
    const bidCsv = exportBidLevelingCSV(BID_SHEET);
    const lines = bidCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(BID_SHEET.tradePackages.length + 1);
  });

  test('Clash CSV has header', () => {
    const clashCsv = exportClashReportCSV(CLASH_REPORT);
    expect(clashCsv.split('\n')[0]).toContain('Clash ID');
    expect(clashCsv.split('\n')[0]).toContain('Severity');
  });

  test('Clash CSV has correct clash count', () => {
    const clashCsv = exportClashReportCSV(CLASH_REPORT);
    const lines = clashCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(CLASH_REPORT.clashes.length + 1);
  });

  test('Gap CSV has header', () => {
    const gapCsv = exportGapRegisterCSV(GAP_REGISTER);
    expect(gapCsv.split('\n')[0]).toContain('Gap ID');
    expect(gapCsv.split('\n')[0]).toContain('Discipline');
  });

  test('Gap CSV has correct gap count', () => {
    const gapCsv = exportGapRegisterCSV(GAP_REGISTER);
    const lines = gapCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(GAP_REGISTER.gaps.length + 1);
  });

  test('sheetToCSV handles empty sheet', () => {
    const csv = sheetToCSV({ name: 'Empty', headers: ['A', 'B'], rows: [] });
    expect(csv).toBe('A,B');
  });

  test('sheetToCSV escapes commas in values', () => {
    const csv = sheetToCSV({ name: 'Test', headers: ['Name', 'Value'], rows: [['Hello, World', 42]] });
    expect(csv).toContain('"Hello, World"');
  });

  test('sheetToCSV escapes quotes in values', () => {
    const csv = sheetToCSV({ name: 'Test', headers: ['A'], rows: [['He said "hello"']] });
    expect(csv).toContain('""hello""');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  5. JSON EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('JSON Export', () => {
  test('generates valid JSON', () => {
    const json = exportReportJSON(BOQ_REPORT, 'BOQ_FULL');
    const parsed = JSON.parse(json);
    expect(parsed).toBeTruthy();
  });

  test('includes export metadata', () => {
    const json = exportReportJSON(BOQ_REPORT, 'BOQ_FULL');
    const parsed = JSON.parse(json);
    expect(parsed.exportFormat).toBe('EstimatorPro_v3_Report');
    expect(parsed.exportVersion).toBe('1.0.0');
    expect(parsed.reportType).toBe('BOQ_FULL');
  });

  test('includes report data', () => {
    const json = exportReportJSON(BOQ_REPORT, 'BOQ_FULL');
    const parsed = JSON.parse(json);
    expect(parsed.data.lines).toBeTruthy();
    expect(parsed.data.totalProjectCost).toBeGreaterThan(0);
  });

  test('includes export timestamp', () => {
    const json = exportReportJSON(BOQ_REPORT, 'BOQ_FULL');
    const parsed = JSON.parse(json);
    expect(parsed.exportedAt).toBeTruthy();
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  6. EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('IFC handles elements with missing properties', () => {
    const elements = convertToIFCElements([{ id: 'bare-001', type: 'unknown' }]);
    expect(elements.length).toBe(1);
    expect(elements[0].ifcType).toBe('IfcBuildingElementProxy');
    const ifc = generateIFC4File(elements, 'Bare Test');
    expect(ifc).toContain('IFCBUILDINGELEMENTPROXY');
  });

  test('IFC handles zero-dimension elements', () => {
    const elements = convertToIFCElements([
      { id: 'zero-001', type: 'wall', properties: { width: 0, depth: 0, height: 0 } },
    ]);
    const ifc = generateIFC4File(elements);
    // Should clamp to minimum 0.01
    expect(ifc).toContain('0.010');
  });

  test('MS Project handles single-phase SOV', () => {
    const minimalSOV: ScheduleOfValues = {
      metadata: BOQ_REPORT.metadata as any,
      phases: [{ phaseNumber: 1, phaseName: 'Only Phase', level: null, scheduledValue: 100000, percentOfTotal: 100, milestones: ['Done'], tradeBreakdown: [{ trade: 'GC', amount: 100000 }] }],
      totalContractValue: 100000,
      retainageRate: 0.10,
    };
    const xml = generateMSProjectXML(minimalSOV, 'Minimal');
    expect(xml).toContain('Only Phase');
    expect(xml).toContain('</Project>');
  });

  test('SpreadsheetML handles BOQ with zero lines', () => {
    const emptyBOQ = generateBOQReport('empty', [], DEFAULT_OHP, 1.0, 'ON', 0.13, 'Empty');
    const sheets = buildBOQExportSheets(emptyBOQ);
    const xml = sheetsToSpreadsheetML(sheets, 'Empty');
    expect(xml).toContain('</Workbook>');
  });

  test('CSV export handles empty BOQ report', () => {
    const emptyBOQ = generateBOQReport('empty', [], DEFAULT_OHP, 1.0, 'ON', 0.13, 'Empty');
    const csv = exportBOQtoCSV(emptyBOQ);
    const lines = csv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(1); // Header only
  });

  test('JSON export handles any report type', () => {
    const json = exportReportJSON({ custom: 'data', value: 42 }, 'CUSTOM');
    const parsed = JSON.parse(json);
    expect(parsed.reportType).toBe('CUSTOM');
    expect(parsed.data.custom).toBe('data');
  });
});
