/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  INTEGRATION & EXPORT ENGINE — Regression Test Suite
 *  SOP Part 8 — 90+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

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
} from "../integration-export-engine";

import {
  generateBOQReport,
  generateBidLevelingSheet,
  generateClashReport,
  generateGapRegister,
  generateScheduleOfValues,
} from "../report-generator";


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
  { code: '033000-SLAB-CONC', description: 'Concrete slab', unit: 'm³', qty: 45.6, rate: 285, elementIds: ['slab-001'], evidenceRefs: ['A-101#p1'], storey: 'Level 1' },
  { code: '033000-COL-CONC', description: 'Concrete column', unit: 'm³', qty: 8.4, rate: 310, elementIds: ['col-001'], evidenceRefs: ['S-201#p3'], storey: 'Level 1' },
  { code: '054000-REBAR', description: 'Reinforcing steel', unit: 'kg', qty: 12500, rate: 2.85, elementIds: ['rebar-001'], evidenceRefs: ['S-301#p1'], storey: 'Level 1' },
  { code: '081100-DOOR', description: 'Interior doors', unit: 'ea', qty: 24, rate: 850, elementIds: ['door-001'], evidenceRefs: ['A-401#p1'], storey: 'Level 1' },
  { code: '085100-WINDOW', description: 'Windows', unit: 'ea', qty: 18, rate: 1200, elementIds: ['win-001'], evidenceRefs: ['A-401#p2'], storey: 'Level 1' },
  { code: '092900-DRYWALL', description: 'Gypsum board', unit: 'm²', qty: 890, rate: 38, elementIds: ['wall-001'], evidenceRefs: ['A-201#p3'], storey: 'Level 1' },
  { code: '260519-LIGHT', description: 'Light fixtures', unit: 'ea', qty: 48, rate: 320, elementIds: ['light-001'], evidenceRefs: ['E-101#p1'], storey: 'Level 1' },
  { code: '033000-SLAB-CONC', description: 'Concrete slab L2', unit: 'm³', qty: 42, rate: 285, elementIds: ['slab-002'], evidenceRefs: ['A-102#p1'], storey: 'Level 2' },
];

const DEFAULT_OHP = { overhead: 0.10, profit: 0.08, contingency: 0.10 };
const PROJECT_ID = 'proj-export-001';
const PROJECT_NAME = 'The Moorings on Cameron Lake';

// Pre-generate reports for export tests
const BOQ_REPORT = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);
const BID_SHEET = generateBidLevelingSheet(BOQ_REPORT, PROJECT_NAME);
const CLASH_REPORT = generateClashReport(PROJECT_ID, {
  clashes: [
    { clashId: 'C1', severity: 'CRITICAL', category: 'HARD_CLASH', elementAId: 'duct-001', elementBId: 'beam-001', location: 'Grid B-3', storey: 'Level 1', penetrationDepth_mm: 120, description: 'Duct hits beam' },
    { clashId: 'C2', severity: 'MEDIUM', category: 'CLEARANCE', elementAId: 'pipe-001', elementBId: 'duct-001', location: 'Grid C-4', storey: 'Level 1', penetrationDepth_mm: 30, description: 'Pipe clearance issue' },
  ],
}, PROJECT_NAME);
const GAP_REGISTER = generateGapRegister(PROJECT_ID, PROJECT_NAME, [
  { id: 'G1', type: 'missing_dimension', parameterName: 'wall_height', description: 'Wall height missing', discipline: 'Architectural', impact: 'critical', affectedCount: 12, sopReference: 'SOP 6.3', evidenceRef: { documentId: 'A-201' } },
  { id: 'G2', type: 'missing_spec', parameterName: 'insulation', description: 'R-value not specified', discipline: 'Architectural', impact: 'high', affectedCount: 8, sopReference: 'SOP 4', evidenceRef: null },
] as any);
const SOV = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, BOQ_REPORT, null);


// ══════════════════════════════════════════════════════════════════════════════
//  TEST RUNNER
// ══════════════════════════════════════════════════════════════════════════════

interface TestResult { name: string; passed: boolean; error?: string; }
const results: TestResult[] = [];
let currentGroup = '';

function describe(group: string, fn: () => void) { currentGroup = group; fn(); }
function it(name: string, fn: () => void) {
  try { fn(); results.push({ name: `${currentGroup} > ${name}`, passed: true }); }
  catch (e: any) { results.push({ name: `${currentGroup} > ${name}`, passed: false, error: e.message }); }
}
function expect(val: any) {
  return {
    toBe(expected: any) { if (val !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`); },
    toBeGreaterThan(n: number) { if (!(val > n)) throw new Error(`Expected ${val} > ${n}`); },
    toBeGreaterThanOrEqual(n: number) { if (!(val >= n)) throw new Error(`Expected ${val} >= ${n}`); },
    toBeLessThan(n: number) { if (!(val < n)) throw new Error(`Expected ${val} < ${n}`); },
    toBeTruthy() { if (!val) throw new Error(`Expected truthy, got ${val}`); },
    toContain(str: string) {
      if (typeof val === 'string' && !val.includes(str)) throw new Error(`Expected to contain "${str}"`);
      if (Array.isArray(val) && !val.includes(str)) throw new Error(`Array expected to contain "${str}"`);
    },
    not: { toContain(str: string) { if (typeof val === 'string' && val.includes(str)) throw new Error(`Expected NOT to contain "${str}"`); } },
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  1. IFC4 EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('IFC4 STEP Export', () => {
  const ifcElements = convertToIFCElements(SAMPLE_BIM_ELEMENTS);

  it('converts BIM elements to IFC format', () => {
    expect(ifcElements.length).toBe(SAMPLE_BIM_ELEMENTS.length);
  });

  it('maps wall elements to IfcWall', () => {
    const walls = ifcElements.filter(e => e.ifcType === 'IfcWall');
    expect(walls.length).toBe(2);
  });

  it('maps slab elements to IfcSlab', () => {
    const slabs = ifcElements.filter(e => e.ifcType === 'IfcSlab');
    expect(slabs.length).toBe(2);
  });

  it('maps column to IfcColumn', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcColumn')).toBeTruthy();
  });

  it('maps beam to IfcBeam', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcBeam')).toBeTruthy();
  });

  it('maps door to IfcDoor', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcDoor')).toBeTruthy();
  });

  it('maps window to IfcWindow', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcWindow')).toBeTruthy();
  });

  it('maps roof to IfcRoof', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcRoof')).toBeTruthy();
  });

  it('maps duct to IfcDuctSegment', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcDuctSegment')).toBeTruthy();
  });

  it('maps pipe to IfcPipeSegment', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcPipeSegment')).toBeTruthy();
  });

  it('maps light to IfcLightFixture', () => {
    expect(ifcElements.find(e => e.ifcType === 'IfcLightFixture')).toBeTruthy();
  });

  it('preserves geometry', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.geometry.width).toBe(0.2);
    expect(wall.geometry.depth).toBe(6.0);
    expect(wall.geometry.height).toBe(3.0);
  });

  it('preserves material name', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.materialName).toBe('200mm CMU');
  });

  it('preserves custom properties', () => {
    const wall = ifcElements.find(e => e.id === 'wall-001')!;
    expect(wall.properties.fireRating).toBe('2hr');
  });

  // IFC file generation
  const ifcFile = generateIFC4File(ifcElements, PROJECT_NAME, 'Test Author');

  it('generates valid IFC4 header', () => {
    expect(ifcFile).toContain('ISO-10303-21;');
    expect(ifcFile).toContain("FILE_SCHEMA(('IFC4'));");
  });

  it('includes project name in header', () => {
    expect(ifcFile).toContain(PROJECT_NAME);
  });

  it('includes ENDSEC and END-ISO-10303-21', () => {
    expect(ifcFile).toContain('ENDSEC;');
    expect(ifcFile).toContain('END-ISO-10303-21;');
  });

  it('includes DATA section', () => {
    expect(ifcFile).toContain('DATA;');
  });

  it('includes IFCPROJECT entity', () => {
    expect(ifcFile).toContain('IFCPROJECT');
  });

  it('includes IFCSITE entity', () => {
    expect(ifcFile).toContain('IFCSITE');
  });

  it('includes IFCBUILDING entity', () => {
    expect(ifcFile).toContain('IFCBUILDING');
  });

  it('includes IFCBUILDINGSTOREY entities', () => {
    expect(ifcFile).toContain('IFCBUILDINGSTOREY');
  });

  it('includes element entities (IFCWALL etc)', () => {
    expect(ifcFile).toContain('IFCWALL');
    expect(ifcFile).toContain('IFCSLAB');
    expect(ifcFile).toContain('IFCCOLUMN');
    expect(ifcFile).toContain('IFCDOOR');
  });

  it('includes spatial containment', () => {
    expect(ifcFile).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE');
  });

  it('includes aggregation relationships', () => {
    expect(ifcFile).toContain('IFCRELAGGREGATES');
  });

  it('includes property sets', () => {
    expect(ifcFile).toContain('IFCPROPERTYSET');
    expect(ifcFile).toContain('EstimatorPro_Properties');
  });

  it('includes SI units (metre)', () => {
    expect(ifcFile).toContain('IFCSIUNIT');
    expect(ifcFile).toContain('.METRE.');
  });

  it('includes bounding box geometry', () => {
    expect(ifcFile).toContain('IFCBOUNDINGBOX');
    expect(ifcFile).toContain('IFCSHAPEREPRESENTATION');
  });

  it('handles empty elements array', () => {
    const empty = generateIFC4File([], 'Empty Project');
    expect(empty).toContain('ISO-10303-21;');
    expect(empty).toContain('END-ISO-10303-21;');
    expect(empty).toContain('IFCPROJECT');
  });

  it('generates substantial file size', () => {
    expect(ifcFile.length).toBeGreaterThan(2000);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  2. MS PROJECT XML TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('MS Project XML Export', () => {
  const xml = generateMSProjectXML(SOV, PROJECT_NAME, '2025-04-01');

  it('generates valid XML header', () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Project xmlns=');
  });

  it('includes project name', () => {
    expect(xml).toContain(PROJECT_NAME);
  });

  it('includes CAD currency', () => {
    expect(xml).toContain('<CurrencyCode>CAD</CurrencyCode>');
  });

  it('includes calendar', () => {
    expect(xml).toContain('<Calendar>');
    expect(xml).toContain('Standard');
  });

  it('includes tasks for each phase', () => {
    expect(xml).toContain('<Tasks>');
    // Phase names with & get XML-escaped to &amp;
    expect(xml).toContain('Mobilization');
    expect(xml).toContain('Commissioning');
  });

  it('includes summary task UID 0', () => {
    expect(xml).toContain('<UID>0</UID>');
  });

  it('includes task durations', () => {
    expect(xml).toContain('<Duration>PT');
  });

  it('includes milestones', () => {
    expect(xml).toContain('<Milestone>1</Milestone>');
  });

  it('includes task costs', () => {
    expect(xml).toContain('<Cost>');
  });

  it('includes start date', () => {
    expect(xml).toContain('2025-04-01');
  });

  it('includes weekday definitions', () => {
    expect(xml).toContain('<WeekDay>');
    expect(xml).toContain('<DayWorking>');
  });

  it('closes XML properly', () => {
    expect(xml).toContain('</Project>');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  3. SPREADSHEETML EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('SpreadsheetML XLSX Export', () => {
  const sheets = buildBOQExportSheets(BOQ_REPORT);

  it('generates 6 sheets', () => {
    expect(sheets.length).toBe(6);
  });

  it('sheet 1 is Executive Summary', () => {
    expect(sheets[0].name).toBe('Executive Summary');
  });

  it('sheet 2 is BOQ Detail', () => {
    expect(sheets[1].name).toBe('BOQ Detail');
  });

  it('sheet 3 is Division Summary', () => {
    expect(sheets[2].name).toBe('Division Summary');
  });

  it('sheet 4 is Storey Summary', () => {
    expect(sheets[3].name).toBe('Storey Summary');
  });

  it('sheet 5 is Trade Packages', () => {
    expect(sheets[4].name).toBe('Trade Packages');
  });

  it('sheet 6 is Confidence Analysis', () => {
    expect(sheets[5].name).toBe('Confidence Analysis');
  });

  it('BOQ Detail has correct column count', () => {
    expect(sheets[1].headers.length).toBe(17);
  });

  it('BOQ Detail rows match report lines', () => {
    expect(sheets[1].rows.length).toBe(BOQ_REPORT.lines.length);
  });

  it('Division Summary has rows for each division', () => {
    // +1 for total row
    expect(sheets[2].rows.length).toBe(BOQ_REPORT.divisionSubtotals.length + 1);
  });

  it('Executive Summary includes total project cost', () => {
    const totalRow = sheets[0].rows.find(r => r[0] === 'TOTAL PROJECT COST');
    expect(totalRow).toBeTruthy();
  });

  // SpreadsheetML generation
  const xml = sheetsToSpreadsheetML(sheets, PROJECT_NAME);

  it('generates valid SpreadsheetML', () => {
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<Workbook');
    expect(xml).toContain('</Workbook>');
  });

  it('includes all worksheet names', () => {
    for (const sheet of sheets) {
      expect(xml).toContain(sheet.name);
    }
  });

  it('includes styles', () => {
    expect(xml).toContain('<Styles>');
    expect(xml).toContain('Header');
    expect(xml).toContain('Money');
    expect(xml).toContain('TotalRow');
    expect(xml).toContain('GapRow');
  });

  it('includes document properties', () => {
    expect(xml).toContain('<DocumentProperties');
    expect(xml).toContain('EstimatorPro v3');
  });

  it('includes column widths', () => {
    expect(xml).toContain('<Column ss:Width=');
  });

  it('includes data cells', () => {
    expect(xml).toContain('<Data ss:Type="Number">');
    expect(xml).toContain('<Data ss:Type="String">');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  4. CSV EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('CSV Exports', () => {
  // BOQ CSV
  const boqCsv = exportBOQtoCSV(BOQ_REPORT);

  it('BOQ CSV has header row', () => {
    const firstLine = boqCsv.split('\n')[0];
    expect(firstLine).toContain('Line No');
    expect(firstLine).toContain('CSI Division');
    expect(firstLine).toContain('Total Cost');
  });

  it('BOQ CSV has correct row count', () => {
    const lines = boqCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(BOQ_REPORT.lines.length + 1); // +1 for header
  });

  // Division CSV
  const divCsv = exportDivisionSummaryCSV(BOQ_REPORT);

  it('Division CSV has header', () => {
    expect(divCsv.split('\n')[0]).toContain('Division');
  });

  it('Division CSV has rows', () => {
    expect(divCsv.split('\n').length).toBeGreaterThan(1);
  });

  // Trade Package CSV
  const tradeCsv = exportTradePackageCSV(BOQ_REPORT);

  it('Trade CSV has header', () => {
    expect(tradeCsv.split('\n')[0]).toContain('Trade Package');
  });

  // Bid-Leveling CSV
  const bidCsv = exportBidLevelingCSV(BID_SHEET);

  it('Bid-leveling CSV has header', () => {
    expect(bidCsv.split('\n')[0]).toContain('Trade Package');
    expect(bidCsv.split('\n')[0]).toContain('Base Amount');
  });

  it('Bid-leveling CSV has rows for each trade', () => {
    const lines = bidCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(BID_SHEET.tradePackages.length + 1);
  });

  // Clash Report CSV
  const clashCsv = exportClashReportCSV(CLASH_REPORT);

  it('Clash CSV has header', () => {
    expect(clashCsv.split('\n')[0]).toContain('Clash ID');
    expect(clashCsv.split('\n')[0]).toContain('Severity');
  });

  it('Clash CSV has correct clash count', () => {
    const lines = clashCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(CLASH_REPORT.clashes.length + 1);
  });

  // Gap Register CSV
  const gapCsv = exportGapRegisterCSV(GAP_REGISTER);

  it('Gap CSV has header', () => {
    expect(gapCsv.split('\n')[0]).toContain('Gap ID');
    expect(gapCsv.split('\n')[0]).toContain('Discipline');
  });

  it('Gap CSV has correct gap count', () => {
    const lines = gapCsv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(GAP_REGISTER.gaps.length + 1);
  });

  // Sheet to CSV utility
  it('sheetToCSV handles empty sheet', () => {
    const csv = sheetToCSV({ name: 'Empty', headers: ['A', 'B'], rows: [] });
    expect(csv).toBe('A,B');
  });

  it('sheetToCSV escapes commas in values', () => {
    const csv = sheetToCSV({ name: 'Test', headers: ['Name', 'Value'], rows: [['Hello, World', 42]] });
    expect(csv).toContain('"Hello, World"');
  });

  it('sheetToCSV escapes quotes in values', () => {
    const csv = sheetToCSV({ name: 'Test', headers: ['A'], rows: [['He said "hello"']] });
    expect(csv).toContain('""hello""');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  5. JSON EXPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('JSON Export', () => {
  const json = exportReportJSON(BOQ_REPORT, 'BOQ_FULL');

  it('generates valid JSON', () => {
    const parsed = JSON.parse(json);
    expect(parsed).toBeTruthy();
  });

  it('includes export metadata', () => {
    const parsed = JSON.parse(json);
    expect(parsed.exportFormat).toBe('EstimatorPro_v3_Report');
    expect(parsed.exportVersion).toBe('1.0.0');
    expect(parsed.reportType).toBe('BOQ_FULL');
  });

  it('includes report data', () => {
    const parsed = JSON.parse(json);
    expect(parsed.data.lines).toBeTruthy();
    expect(parsed.data.totalProjectCost).toBeGreaterThan(0);
  });

  it('includes export timestamp', () => {
    const parsed = JSON.parse(json);
    expect(parsed.exportedAt).toBeTruthy();
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  6. EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('IFC handles elements with missing properties', () => {
    const elements = convertToIFCElements([{ id: 'bare-001', type: 'unknown' }]);
    expect(elements.length).toBe(1);
    expect(elements[0].ifcType).toBe('IfcBuildingElementProxy');
    const ifc = generateIFC4File(elements, 'Bare Test');
    expect(ifc).toContain('IFCBUILDINGELEMENTPROXY');
  });

  it('IFC handles zero-dimension elements', () => {
    const elements = convertToIFCElements([
      { id: 'zero-001', type: 'wall', properties: { width: 0, depth: 0, height: 0 } },
    ]);
    const ifc = generateIFC4File(elements);
    // Should clamp to minimum 0.01
    expect(ifc).toContain('0.010');
  });

  it('MS Project handles single-phase SOV', () => {
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

  it('SpreadsheetML handles BOQ with zero lines', () => {
    const emptyBOQ = generateBOQReport('empty', [], DEFAULT_OHP, 1.0, 'ON', 0.13, 'Empty');
    const sheets = buildBOQExportSheets(emptyBOQ);
    const xml = sheetsToSpreadsheetML(sheets, 'Empty');
    expect(xml).toContain('</Workbook>');
  });

  it('CSV export handles empty BOQ report', () => {
    const emptyBOQ = generateBOQReport('empty', [], DEFAULT_OHP, 1.0, 'ON', 0.13, 'Empty');
    const csv = exportBOQtoCSV(emptyBOQ);
    const lines = csv.split('\n').filter(l => l.trim());
    expect(lines.length).toBe(1); // Header only
  });

  it('JSON export handles any report type', () => {
    const json = exportReportJSON({ custom: 'data', value: 42 }, 'CUSTOM');
    const parsed = JSON.parse(json);
    expect(parsed.reportType).toBe('CUSTOM');
    expect(parsed.data.custom).toBe('data');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  RUN ALL TESTS
// ══════════════════════════════════════════════════════════════════════════════

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

console.log('');
console.log('═'.repeat(80));
console.log(`  SOP Part 8 — Integration & Export Engine Regression Tests`);
console.log('═'.repeat(80));

if (failed > 0) {
  console.log(`\n  FAILURES:\n`);
  for (const r of results.filter(r => !r.passed)) {
    console.log(`  ✗ ${r.name}`);
    console.log(`    ${r.error}`);
  }
}

console.log(`\n  RESULTS: ${passed}/${total} passed, ${failed} failed`);
console.log('═'.repeat(80));

if (failed > 0) process.exit(1);
