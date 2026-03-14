/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  REPORT GENERATOR — Jest Test Suite
 *  SOP Part 7
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock storage before importing the module under test
jest.mock('../../storage', () => ({
  storage: {},
}));

import {
  generateBOQReport,
  generateBidLevelingSheet,
  generateClashReport,
  generateConstructabilityReport,
  generateExecutiveSummary,
  generateGapRegister,
  generateScheduleOfValues,
  formatBOQReportText,
  formatExecutiveSummaryText,
} from "../report-generator";


// ══════════════════════════════════════════════════════════════════════════════
//  TEST DATA — Realistic estimate lines from estimate-engine.ts format
// ══════════════════════════════════════════════════════════════════════════════

const SAMPLE_ESTIMATE_LINES = [
  { code: '033000-SLAB-CONC', description: 'Concrete slab', unit: 'm\u00B3', qty: 45.6, rate: 285, elementIds: ['slab-001', 'slab-002'], evidenceRefs: ['A-101#p1 @ (10,20)', 'S-201#p3 @ (5,15)'], storey: 'Level 1' },
  { code: '033000-COL-CONC', description: 'Concrete column', unit: 'm\u00B3', qty: 8.4, rate: 310, elementIds: ['col-001'], evidenceRefs: ['S-201#p3 @ (12,30)'], storey: 'Level 1' },
  { code: '033000-BEAM-CONC', description: 'Concrete beam', unit: 'm\u00B3', qty: 12.8, rate: 295, elementIds: ['beam-001', 'beam-002'], evidenceRefs: ['S-201#p4 @ (8,22)'], storey: 'Level 1' },
  { code: '033000-SLAB-CONC', description: 'Concrete slab', unit: 'm\u00B3', qty: 42.1, rate: 285, elementIds: ['slab-003'], evidenceRefs: ['A-102#p1 @ (10,20)'], storey: 'Level 2' },
  { code: '033000-COL-CONC', description: 'Concrete column', unit: 'm\u00B3', qty: 7.8, rate: 310, elementIds: ['col-002'], evidenceRefs: ['S-202#p3 @ (12,30)'], storey: 'Level 2' },
  { code: '054000-REBAR', description: 'Reinforcing steel', unit: 'kg', qty: 12500, rate: 2.85, elementIds: ['rebar-001'], evidenceRefs: ['S-301#p1 @ (5,10)'], storey: 'Level 1' },
  { code: '054000-REBAR', description: 'Reinforcing steel', unit: 'kg', qty: 11200, rate: 2.85, elementIds: ['rebar-002'], evidenceRefs: ['S-302#p1 @ (5,10)'], storey: 'Level 2' },
  { code: '061000-FRAMING', description: 'Wood framing', unit: 'm', qty: 380, rate: 42, elementIds: ['frame-001'], evidenceRefs: ['A-201#p2 @ (15,8)'], storey: 'Level 2' },
  { code: '072100-INSULATION', description: 'Thermal insulation', unit: 'm\u00B2', qty: 520, rate: 28, elementIds: ['ins-001'], evidenceRefs: ['A-301#p1 @ (20,5)'], storey: 'Level 1' },
  { code: '081100-DOOR', description: 'Interior doors', unit: 'ea', qty: 24, rate: 850, elementIds: ['door-001', 'door-002'], evidenceRefs: ['A-401#p1 @ (3,12)'], storey: 'Level 1' },
  { code: '085100-WINDOW', description: 'Windows', unit: 'ea', qty: 18, rate: 1200, elementIds: ['win-001'], evidenceRefs: ['A-401#p2 @ (8,15)'], storey: 'Level 1' },
  { code: '092900-DRYWALL', description: 'Gypsum board partition', unit: 'm\u00B2', qty: 890, rate: 38, elementIds: ['wall-001'], evidenceRefs: ['A-201#p3 @ (10,10)'], storey: 'Level 1' },
  { code: '095000-CEILING', description: 'Suspended ceiling', unit: 'm\u00B2', qty: 420, rate: 45, elementIds: ['ceil-001'], evidenceRefs: ['A-501#p1 @ (5,5)'], storey: 'Level 1' },
  { code: '096500-FLOORING', description: 'Resilient flooring', unit: 'm\u00B2', qty: 420, rate: 65, elementIds: ['floor-001'], evidenceRefs: ['A-501#p2 @ (5,10)'], storey: 'Level 1' },
  { code: '099100-PAINT', description: 'Interior painting', unit: 'm\u00B2', qty: 1800, rate: 12, elementIds: ['paint-001'], evidenceRefs: [], storey: 'Level 1' },  // NO evidence -> GAP
  { code: '220000-PLUMBING', description: 'Plumbing rough-in', unit: 'ea', qty: 16, rate: 3200, elementIds: ['plmb-001'], evidenceRefs: ['M-101#p1 @ (2,8)'], storey: 'Level 1' },
  { code: '230000-HVAC', description: 'HVAC ductwork', unit: 'm', qty: 240, rate: 85, elementIds: ['duct-001'], evidenceRefs: ['M-201#p1 @ (12,18)'], storey: 'Level 1' },
  { code: '260519-LIGHT', description: 'Light fixtures', unit: 'ea', qty: 48, rate: 320, elementIds: ['light-001'], evidenceRefs: ['E-101#p1 @ (8,8)'], storey: 'Level 1' },
  { code: '260519-REC', description: 'Receptacles', unit: 'ea', qty: 64, rate: 180, elementIds: ['rec-001'], evidenceRefs: ['E-101#p2 @ (10,12)'], storey: 'Level 1' },
  { code: '210000-SPR', description: 'Sprinkler heads', unit: 'ea', qty: 36, rate: 280, elementIds: ['spr-001'], evidenceRefs: ['FP-101#p1 @ (6,14)'], storey: 'Level 1' },
  { code: '311000-EXCAVATION', description: 'Excavation', unit: 'm\u00B3', qty: 850, rate: 18, elementIds: ['exc-001'], evidenceRefs: ['C-101#p1 @ (1,1)'], storey: 'Foundation' },
  // GAP items -- no evidence, zero qty, or zero rate
  { code: '042000-MASONRY', description: 'Exterior masonry veneer', unit: 'm\u00B2', qty: 0, rate: 165, elementIds: ['mas-001'], evidenceRefs: ['A-301#p3 @ (18,20)'], storey: 'Level 1' },  // zero qty -> LOW
  { code: '143000-ELEVATOR', description: 'Passenger elevator', unit: 'ea', qty: 1, rate: 0, elementIds: ['elev-001'], evidenceRefs: [], storey: 'Level 1' },  // zero rate + no evidence -> GAP
];

const DEFAULT_OHP = { overhead: 0.10, profit: 0.08, contingency: 0.10 };
const PROJECT_ID = 'proj-moorings-001';
const PROJECT_NAME = 'The Moorings on Cameron Lake';


// ══════════════════════════════════════════════════════════════════════════════
//  1. BOQ REPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('BOQ Report Generator', () => {
  const report = generateBOQReport(
    PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME,
  );

  // Metadata
  test('generates report metadata', () => {
    expect(report.metadata.reportId).toBeTruthy();
    expect(report.metadata.projectId).toBe(PROJECT_ID);
    expect(report.metadata.reportType).toBe('BOQ_FULL');
    expect(report.metadata.version).toBe('1.0.0');
  });

  test('includes CIQS disclaimer', () => {
    expect(report.metadata.disclaimer).toContain('Canadian Institute of Quantity Surveyors');
  });

  test('lists professional standards', () => {
    expect(report.metadata.standards).toContain('CIQS Standard Method');
    expect(report.metadata.standards).toContain('CSI MasterFormat 2018');
  });

  // Line items
  test('generates correct number of report lines', () => {
    expect(report.lines.length).toBeGreaterThan(0);
    expect(report.lines.length).toBeLessThanOrEqual(SAMPLE_ESTIMATE_LINES.length);
  });

  test('assigns CSI divisions to every line', () => {
    for (const line of report.lines) {
      expect(line.csiDivision).toBeTruthy();
      expect(line.csiTitle).toBeTruthy();
    }
  });

  test('assigns trade packages to every line', () => {
    for (const line of report.lines) {
      expect(line.tradePackage).toBeTruthy();
    }
  });

  test('assigns storey to every line', () => {
    for (const line of report.lines) {
      expect(line.storey).toBeTruthy();
    }
  });

  test('splits costs into material/labour/equipment per line', () => {
    for (const line of report.lines) {
      if (line.quantity > 0 && line.totalCost > 0) {
        const sum = line.materialCost + line.labourCost + line.equipmentCost;
        // Allow 1% tolerance for rounding
        expect(Math.abs(sum - line.totalCost)).toBeLessThan(line.totalCost * 0.01 + 1);
      }
    }
  });

  test('applies regional factor to costs', () => {
    expect(report.regionalFactor).toBe(1.05);
    // First line: qty=45.6, rate=285, regional=1.05
    // totalCost should be 45.6 * 285 * 1.05 = 13,642.80
    const firstSlab = report.lines.find(l => l.description === 'Concrete slab' && l.storey === 'Level 1');
    expect(firstSlab).toBeTruthy();
    if (firstSlab) {
      const expected = 45.6 * 285 * 1.05;
      expect(Math.abs(firstSlab.totalCost - expected)).toBeLessThan(1);
    }
  });

  // Storey subtotals
  test('generates storey subtotals', () => {
    expect(report.storeySubtotals.length).toBeGreaterThan(0);
  });

  test('has Level 1 and Level 2 subtotals', () => {
    const l1 = report.storeySubtotals.find(s => s.storey === 'Level 1');
    const l2 = report.storeySubtotals.find(s => s.storey === 'Level 2');
    expect(l1).toBeTruthy();
    expect(l2).toBeTruthy();
  });

  test('storey subtotals sum to direct cost', () => {
    const storeySumTotal = report.storeySubtotals.reduce((s, st) => s + st.totalCost, 0);
    expect(Math.abs(storeySumTotal - report.directCost)).toBeLessThan(1);
  });

  // Division subtotals
  test('generates division subtotals', () => {
    expect(report.divisionSubtotals.length).toBeGreaterThan(0);
  });

  test('includes Division 03 (Concrete)', () => {
    const div03 = report.divisionSubtotals.find(d => d.division === '03');
    expect(div03).toBeTruthy();
    if (div03) {
      expect(div03.title).toBe('Concrete');
      expect(div03.totalCost).toBeGreaterThan(0);
    }
  });

  test('division subtotals sum to direct cost', () => {
    const divSum = report.divisionSubtotals.reduce((s, d) => s + d.totalCost, 0);
    expect(Math.abs(divSum - report.directCost)).toBeLessThan(1);
  });

  // Trade package subtotals
  test('generates trade package subtotals', () => {
    expect(report.tradePackageSubtotals.length).toBeGreaterThan(0);
  });

  test('trade package subtotals sum to direct cost', () => {
    const tpSum = report.tradePackageSubtotals.reduce((s, tp) => s + tp.totalCost, 0);
    expect(Math.abs(tpSum - report.directCost)).toBeLessThan(1);
  });

  // Cost roll-up
  test('calculates overhead correctly', () => {
    const expected = report.directCost * 0.10;
    expect(Math.abs(report.overheadAmount - expected)).toBeLessThan(1);
  });

  test('calculates profit correctly', () => {
    const expected = report.directCost * 0.08;
    expect(Math.abs(report.profitAmount - expected)).toBeLessThan(1);
  });

  test('calculates contingency on subtotal (direct + OH + P)', () => {
    const subtotal = report.directCost + report.overheadAmount + report.profitAmount;
    const expected = subtotal * 0.10;
    expect(Math.abs(report.contingencyAmount - expected)).toBeLessThan(1);
  });

  test('calculates tax on subtotal after contingency', () => {
    const subtotal = report.directCost + report.overheadAmount + report.profitAmount + report.contingencyAmount;
    const expected = subtotal * 0.13;
    expect(Math.abs(report.taxAmount - expected)).toBeLessThan(1);
  });

  test('total project cost includes all components', () => {
    const expected = report.directCost + report.overheadAmount + report.profitAmount + report.contingencyAmount + report.taxAmount;
    expect(Math.abs(report.totalProjectCost - expected)).toBeLessThan(1);
  });

  test('total project cost is positive', () => {
    expect(report.totalProjectCost).toBeGreaterThan(0);
  });

  // Confidence
  test('calculates confidence summary', () => {
    expect(report.confidenceSummary.highCount).toBeGreaterThan(0);
    expect(report.confidenceSummary.overallConfidence).toBeGreaterThan(0);
    expect(report.confidenceSummary.overallConfidence).toBeLessThanOrEqual(100);
  });

  test('detects GAP items (no evidence)', () => {
    // paint-001 has no evidence refs, elevator has no evidence + zero rate
    expect(report.confidenceSummary.gapCount).toBeGreaterThanOrEqual(2);
  });

  test('detects LOW items (zero quantity)', () => {
    expect(report.confidenceSummary.lowCount).toBeGreaterThanOrEqual(1);
  });

  test('generates gap warnings when gaps exist', () => {
    expect(report.gapWarnings.length).toBeGreaterThan(0);
  });

  // Lines sorted by CSI division
  test('sorts lines by CSI division', () => {
    for (let i = 1; i < report.lines.length; i++) {
      const prev = report.lines[i - 1].csiDivision;
      const curr = report.lines[i].csiDivision;
      expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  2. BID-LEVELING SHEET TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Bid-Leveling Sheet Generator', () => {
  const boq = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);
  const sheet = generateBidLevelingSheet(boq, PROJECT_NAME);

  test('generates metadata', () => {
    expect(sheet.metadata.reportType).toBe('BID_LEVELING');
    expect(sheet.metadata.projectName).toBe(PROJECT_NAME);
  });

  test('creates trade packages', () => {
    expect(sheet.tradePackages.length).toBeGreaterThan(0);
  });

  test('each trade package has CSI divisions', () => {
    for (const tp of sheet.tradePackages) {
      expect(tp.csiDivisions.length).toBeGreaterThan(0);
    }
  });

  test('each trade package has a scope description', () => {
    for (const tp of sheet.tradePackages) {
      expect(tp.scope.length).toBeGreaterThan(0);
    }
  });

  test('each trade package has a base amount', () => {
    for (const tp of sheet.tradePackages) {
      expect(tp.baseAmount).toBeGreaterThanOrEqual(0);
    }
  });

  test('total base matches sum of trade packages', () => {
    const sum = sheet.tradePackages.reduce((s, tp) => s + tp.baseAmount, 0);
    expect(Math.abs(sum - sheet.totalBase)).toBeLessThan(1);
  });

  test('generates allowances for GAP items', () => {
    const totalAllowances = sheet.tradePackages.reduce((s, tp) => s + tp.allowances.length, 0);
    expect(totalAllowances).toBeGreaterThan(0);
  });

  test('generates unit prices for measurable items', () => {
    const totalUP = sheet.tradePackages.reduce((s, tp) => s + tp.unitPrices.length, 0);
    expect(totalUP).toBeGreaterThan(0);
  });

  test('each trade package has exclusions', () => {
    for (const tp of sheet.tradePackages) {
      expect(tp.exclusions.length).toBeGreaterThan(0);
    }
  });

  test('each trade package has clarifications', () => {
    for (const tp of sheet.tradePackages) {
      expect(tp.clarifications.length).toBeGreaterThan(0);
    }
  });

  test('trade packages sorted by base amount descending', () => {
    for (let i = 1; i < sheet.tradePackages.length; i++) {
      expect(sheet.tradePackages[i - 1].baseAmount).toBeGreaterThanOrEqual(sheet.tradePackages[i].baseAmount);
    }
  });

  test('generates Concrete alternates when Concrete trade exists', () => {
    const conc = sheet.tradePackages.find(tp => tp.tradePackage.includes('Concrete'));
    if (conc) {
      expect(conc.alternates.length).toBeGreaterThan(0);
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  3. CLASH REPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Clash Report Generator', () => {
  const mockClashResult = {
    clashes: [
      { clashId: 'CLH-001', severity: 'CRITICAL', category: 'HARD_CLASH', elementAId: 'duct-001', elementBId: 'beam-001', location: 'Grid B-3', storey: 'Level 1', penetrationDepth_mm: 120, description: 'HVAC duct penetrates concrete beam', recommendation: 'Reroute duct below beam', disciplineA: 'Mechanical' },
      { clashId: 'CLH-002', severity: 'HIGH', category: 'CLEARANCE', elementAId: 'pipe-001', elementBId: 'duct-002', location: 'Grid C-4', storey: 'Level 1', penetrationDepth_mm: 45, description: 'Insufficient clearance between pipe and duct', recommendation: 'Adjust pipe routing', disciplineA: 'Plumbing' },
      { clashId: 'CLH-003', severity: 'MEDIUM', category: 'SOFT_CLASH', elementAId: 'conduit-001', elementBId: 'spr-001', location: 'Grid A-2', storey: 'Level 2', penetrationDepth_mm: 20, description: 'Conduit interferes with sprinkler drop', recommendation: 'Relocate conduit', disciplineA: 'Electrical' },
      { clashId: 'CLH-004', severity: 'LOW', category: 'WORKFLOW', elementAId: 'wall-001', elementBId: 'door-001', location: 'Grid D-5', storey: 'Level 1', penetrationDepth_mm: 0, description: 'Wall finish sequence conflict', recommendation: 'Coordinate schedule', disciplineA: 'Architectural' },
      { clashId: 'CLH-005', severity: 'INFORMATIONAL', category: 'DUPLICATE', elementAId: 'light-001', elementBId: 'light-002', location: 'Grid B-2', storey: 'Level 1', penetrationDepth_mm: 0, description: 'Duplicate fixture placement', recommendation: 'Verify design intent', disciplineA: 'Electrical' },
    ],
    missingClearanceData: ['HVAC duct to structure clearance not in specs'],
  };

  const report = generateClashReport(PROJECT_ID, mockClashResult, PROJECT_NAME);

  test('generates metadata', () => {
    expect(report.metadata.reportType).toBe('CLASH_REPORT');
  });

  test('counts total clashes correctly', () => {
    expect(report.summary.totalClashes).toBe(5);
  });

  test('counts severities correctly', () => {
    expect(report.summary.criticalCount).toBe(1);
    expect(report.summary.highCount).toBe(1);
    expect(report.summary.mediumCount).toBe(1);
    expect(report.summary.lowCount).toBe(1);
    expect(report.summary.informationalCount).toBe(1);
  });

  test('all clashes unresolved initially', () => {
    expect(report.summary.unresolvedCount).toBe(5);
    expect(report.summary.resolvedCount).toBe(0);
  });

  test('generates RFIs for CRITICAL and HIGH clashes', () => {
    expect(report.rfisRequired.length).toBeGreaterThanOrEqual(2);
  });

  test('RFIs have valid ids and priorities', () => {
    for (const rfi of report.rfisRequired) {
      expect(rfi.rfiId).toBeTruthy();
      expect(rfi.clashIds.length).toBeGreaterThan(0);
    }
  });

  test('estimates rework cost', () => {
    expect(report.summary.estimatedReworkCost).toBeGreaterThan(0);
  });

  test('estimates rework days', () => {
    expect(report.summary.estimatedReworkDays).toBeGreaterThan(0);
  });

  test('clashes sorted by severity', () => {
    const severityMap: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
    for (let i = 1; i < report.clashes.length; i++) {
      const prevS = severityMap[report.clashes[i - 1].severity] ?? 5;
      const currS = severityMap[report.clashes[i].severity] ?? 5;
      expect(prevS).toBeLessThanOrEqual(currS);
    }
  });

  test('includes missing clearance data', () => {
    expect(report.missingClearanceData.length).toBeGreaterThan(0);
  });

  test('handles empty clash result', () => {
    const emptyReport = generateClashReport(PROJECT_ID, { clashes: [] }, PROJECT_NAME);
    expect(emptyReport.summary.totalClashes).toBe(0);
    expect(emptyReport.clashes.length).toBe(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  4. CONSTRUCTABILITY REPORT TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Constructability Report Generator', () => {
  const mockAnalysis = {
    workAreas: [
      { name: 'Zone A', level: 'Level 1', zone: 'North', trades: ['Concrete', 'Electrical'], maxWorkers: 12, accessRoutes: ['Main entrance'], equipmentRequired: ['Crane'] },
      { name: 'Zone B', level: 'Level 2', zone: 'South', trades: ['Framing', 'HVAC'], maxWorkers: 8, accessRoutes: ['Stair 2'], equipmentRequired: [] },
    ],
    tradeDependencies: [
      { predecessorTrade: 'Concrete', successorTrade: 'Framing', dependencyType: 'finish_to_start', lagDays: 7, holdPoint: true, inspectionRequired: true },
      { predecessorTrade: 'Framing', successorTrade: 'Electrical', dependencyType: 'start_to_start', lagDays: 3, holdPoint: false, inspectionRequired: false },
      { predecessorTrade: 'Electrical', successorTrade: 'Drywall', dependencyType: 'finish_to_start', lagDays: 0, holdPoint: true, inspectionRequired: true },
    ],
    safetyIssues: [
      { id: 'SAF-001', severity: 'critical', description: 'Fall protection required above 3m', location: 'Level 2 edge', recommendation: 'Install guard rails per OBC 8.2', codeReference: 'OBC 8.2.1.1' },
      { id: 'SAF-002', severity: 'medium', description: 'Temporary shoring for slab openings', location: 'Level 1 elevator shaft', recommendation: 'Install plywood covers', codeReference: 'OHSA O.Reg 213/91' },
    ],
    tempWorks: [
      { type: 'shoring', description: 'Temporary shoring for L2 slab pour', location: 'Level 1 below', duration: '14 days', estimatedCost: 8500 },
    ],
    gaps: [{ id: 'GAP-C-001', description: 'Crane access route not confirmed' }],
  };

  const report = generateConstructabilityReport(PROJECT_ID, mockAnalysis, PROJECT_NAME);

  test('generates metadata', () => {
    expect(report.metadata.reportType).toBe('CONSTRUCTABILITY');
  });

  test('lists work areas', () => {
    expect(report.workAreas.length).toBe(2);
    expect(report.workAreas[0].name).toBe('Zone A');
  });

  test('lists trade dependencies', () => {
    expect(report.tradeDependencies.length).toBe(3);
  });

  test('identifies hold points', () => {
    expect(report.holdPoints.length).toBe(2);
  });

  test('lists safety issues sorted by severity', () => {
    expect(report.safetyIssues.length).toBe(2);
    expect(report.safetyIssues[0].severity).toBe('critical');
  });

  test('lists temp works', () => {
    expect(report.tempWorks.length).toBe(1);
    expect(report.tempWorks[0].estimatedCost).toBe(8500);
  });

  test('counts gaps', () => {
    expect(report.gapCount).toBe(1);
  });

  test('counts critical issues', () => {
    expect(report.criticalIssueCount).toBe(1);
  });

  test('builds trade execution order', () => {
    expect(report.tradeExecutionOrder.length).toBeGreaterThan(0);
  });

  test('handles empty analysis', () => {
    const empty = generateConstructabilityReport(PROJECT_ID, {}, PROJECT_NAME);
    expect(empty.workAreas.length).toBe(0);
    expect(empty.tradeDependencies.length).toBe(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  5. EXECUTIVE SUMMARY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Executive Summary Generator', () => {
  const boq = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);
  const mockClash = generateClashReport(PROJECT_ID, { clashes: [
    { clashId: 'C1', severity: 'CRITICAL', category: 'HARD', elementAId: 'a', elementBId: 'b' },
  ]}, PROJECT_NAME);
  const mockConst = generateConstructabilityReport(PROJECT_ID, {
    safetyIssues: [{ id: 'S1', severity: 'critical', description: 'test' }],
  }, PROJECT_NAME);
  const mockMC = {
    percentiles: { p10: 180000, p50: 210000, p90: 255000 },
    simulationRuns: 10000,
  };

  const summary = generateExecutiveSummary(
    PROJECT_ID, PROJECT_NAME, boq, mockClash, mockConst, mockMC,
    { location: 'Fenelon Falls, ON', buildingType: 'Residential', grossFloorArea_m2: 850, storeyCount: 3, constructionType: 'Wood Frame', estimateClass: 'Class3' },
  );

  test('generates metadata', () => {
    expect(summary.metadata.reportType).toBe('EXECUTIVE_SUMMARY');
  });

  test('includes project overview', () => {
    expect(summary.projectOverview.projectName).toBe(PROJECT_NAME);
    expect(summary.projectOverview.location).toBe('Fenelon Falls, ON');
    expect(summary.projectOverview.grossFloorArea_m2).toBe(850);
    expect(summary.projectOverview.storeyCount).toBe(3);
  });

  test('includes cost summary with all components', () => {
    expect(summary.costSummary.directCost).toBeGreaterThan(0);
    expect(summary.costSummary.indirectCost).toBeGreaterThan(0);
    expect(summary.costSummary.contingency).toBeGreaterThan(0);
    expect(summary.costSummary.taxes).toBeGreaterThan(0);
    expect(summary.costSummary.totalProjectCost).toBeGreaterThan(0);
  });

  test('calculates cost per m2 when area provided', () => {
    expect(summary.costSummary.costPerM2).toBeGreaterThan(0);
    expect(summary.costSummary.costPerSF).toBeGreaterThan(0);
  });

  test('includes Monte Carlo percentiles', () => {
    expect(summary.confidenceAnalysis.monteCarloP10).toBe(180000);
    expect(summary.confidenceAnalysis.monteCarloP50).toBe(210000);
    expect(summary.confidenceAnalysis.monteCarloP90).toBe(255000);
    expect(summary.confidenceAnalysis.simulationRuns).toBe(10000);
  });

  test('includes accuracy range for Class3', () => {
    expect(summary.confidenceAnalysis.accuracyRange.low).toBe(-10);
    expect(summary.confidenceAnalysis.accuracyRange.high).toBe(20);
  });

  test('includes risk summary', () => {
    expect(summary.riskSummary.clashesFound).toBe(1);
    expect(summary.riskSummary.criticalClashes).toBe(1);
    expect(summary.riskSummary.constructabilityIssues).toBe(1);
  });

  test('generates recommendations based on findings', () => {
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });

  test('includes key assumptions', () => {
    expect(summary.keyAssumptions.length).toBeGreaterThan(0);
  });

  test('includes exclusions', () => {
    expect(summary.exclusions.length).toBeGreaterThan(0);
  });

  test('handles null optional modules', () => {
    const minimal = generateExecutiveSummary(PROJECT_ID, PROJECT_NAME, boq, null, null, null, {});
    expect(minimal.riskSummary.clashesFound).toBe(0);
    expect(minimal.riskSummary.constructabilityIssues).toBe(0);
    expect(minimal.confidenceAnalysis.monteCarloP50).toBeNull();
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  6. GAP REGISTER TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Gap Register Generator', () => {
  const mockGaps = [
    { id: 'GAP-001', type: 'missing_dimension', parameterName: 'wall_height', description: 'Wall height not on drawings', discipline: 'Architectural', impact: 'critical', affectedCount: 12, status: 'open', rfiNumber: 'RFI-001', sopReference: 'SOP 6.3', evidenceRef: { documentId: 'A-201', page: 3 } },
    { id: 'GAP-002', type: 'missing_spec', parameterName: 'insulation_type', description: 'Insulation R-value not specified', discipline: 'Architectural', impact: 'high', affectedCount: 8, status: 'open', rfiNumber: null, sopReference: 'SOP 6.3', evidenceRef: null },
    { id: 'GAP-003', type: 'missing_rate', parameterName: 'elevator_cost', description: 'Elevator cost not received from vendor', discipline: 'Mechanical', impact: 'critical', affectedCount: 1, status: 'pending', rfiNumber: 'RFI-003', sopReference: 'SOP 5', evidenceRef: null },
    { id: 'GAP-004', type: 'ambiguous_detail', parameterName: 'roof_slope', description: 'Roof slope shown differently on A-301 vs A-302', discipline: 'Architectural', impact: 'medium', affectedCount: 4, status: 'open', rfiNumber: null, sopReference: 'SOP 4', evidenceRef: { documentId: 'A-301', sheet: 'ROOF' } },
  ];

  const register = generateGapRegister(PROJECT_ID, PROJECT_NAME, mockGaps as any);

  test('generates metadata', () => {
    expect(register.metadata.reportType).toBe('GAP_REGISTER');
  });

  test('counts total gaps', () => {
    expect(register.totalGaps).toBe(4);
  });

  test('counts critical gaps', () => {
    expect(register.criticalGaps).toBe(2);
  });

  test('counts RFIs generated', () => {
    expect(register.rfisGenerated).toBe(2);
  });

  test('breaks down by discipline', () => {
    expect(register.byDiscipline['Architectural']).toBe(3);
    expect(register.byDiscipline['Mechanical']).toBe(1);
  });

  test('breaks down by type', () => {
    expect(register.byType['missing_dimension']).toBe(1);
    expect(register.byType['missing_spec']).toBe(1);
    expect(register.byType['missing_rate']).toBe(1);
  });

  test('sorts entries by severity', () => {
    const severityMap: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < register.gaps.length; i++) {
      const prev = severityMap[register.gaps[i - 1].impact] ?? 99;
      const curr = severityMap[register.gaps[i].impact] ?? 99;
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });

  test('handles empty gaps', () => {
    const empty = generateGapRegister(PROJECT_ID, PROJECT_NAME, []);
    expect(empty.totalGaps).toBe(0);
    expect(empty.criticalGaps).toBe(0);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  7. SCHEDULE OF VALUES TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Schedule of Values Generator', () => {
  const boq = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);

  test('generates phases without sequencing model', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null, 0.10);
    expect(sov.phases.length).toBeGreaterThan(0);
    expect(sov.totalContractValue).toBe(boq.totalProjectCost);
    expect(sov.retainageRate).toBe(0.10);
  });

  test('includes mobilization phase', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null);
    const mob = sov.phases.find(p => p.phaseName.includes('Mobilization'));
    expect(mob).toBeTruthy();
  });

  test('includes commissioning phase', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null);
    const comm = sov.phases.find(p => p.phaseName.includes('Commissioning'));
    expect(comm).toBeTruthy();
  });

  test('each phase has milestones', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null);
    for (const phase of sov.phases) {
      expect(phase.milestones.length).toBeGreaterThan(0);
    }
  });

  test('each phase has trade breakdown', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null);
    for (const phase of sov.phases) {
      expect(phase.tradeBreakdown.length).toBeGreaterThan(0);
    }
  });

  test('uses sequencing model when provided', () => {
    const mockSeq = {
      phases: [
        { phaseNumber: 1, phaseName: 'Foundation', level: 'L0', activities: [{ trade: 'Concrete' }, { trade: 'Excavation' }], prerequisites: ['Permits'] },
        { phaseNumber: 2, phaseName: 'Superstructure', level: 'L1', activities: [{ trade: 'Concrete' }, { trade: 'Steel' }, { trade: 'Framing' }], prerequisites: ['Foundation complete'] },
      ],
    };
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, mockSeq);
    expect(sov.phases.length).toBe(2);
    expect(sov.phases[0].phaseName).toBe('Foundation');
    expect(sov.phases[1].phaseName).toBe('Superstructure');
  });

  test('generates metadata', () => {
    const sov = generateScheduleOfValues(PROJECT_ID, PROJECT_NAME, boq, null);
    expect(sov.metadata.reportType).toBe('SCHEDULE_OF_VALUES');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  8. TEXT FORMATTER TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Text Formatters', () => {
  const boq = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.05, 'Fenelon Falls, ON', 0.13, PROJECT_NAME);

  test('formats BOQ report as text', () => {
    const text = formatBOQReportText(boq);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('BILL OF QUANTITIES');
    expect(text).toContain(PROJECT_NAME);
  });

  test('BOQ text includes division summary', () => {
    const text = formatBOQReportText(boq);
    expect(text).toContain('CSI DIVISION SUMMARY');
    expect(text).toContain('Concrete');
  });

  test('BOQ text includes cost roll-up', () => {
    const text = formatBOQReportText(boq);
    expect(text).toContain('COST ROLL-UP');
    expect(text).toContain('TOTAL PROJECT COST');
  });

  test('BOQ text includes confidence analysis', () => {
    const text = formatBOQReportText(boq);
    expect(text).toContain('CONFIDENCE ANALYSIS');
  });

  test('BOQ text includes disclaimer', () => {
    const text = formatBOQReportText(boq);
    expect(text).toContain('Canadian Institute of Quantity Surveyors');
  });

  test('formats Executive Summary as text', () => {
    const summary = generateExecutiveSummary(PROJECT_ID, PROJECT_NAME, boq, null, null, null, { grossFloorArea_m2: 850 });
    const text = formatExecutiveSummaryText(summary);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('EXECUTIVE SUMMARY');
    expect(text).toContain(PROJECT_NAME);
  });

  test('Executive Summary text includes cost breakdown', () => {
    const summary = generateExecutiveSummary(PROJECT_ID, PROJECT_NAME, boq, null, null, null, {});
    const text = formatExecutiveSummaryText(summary);
    expect(text).toContain('Direct Cost');
    expect(text).toContain('TOTAL');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
//  9. EDGE CASE TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  test('handles empty estimate lines', () => {
    const report = generateBOQReport(PROJECT_ID, [], DEFAULT_OHP, 1.0, 'ON', 0.13, PROJECT_NAME);
    expect(report.lines.length).toBe(0);
    expect(report.directCost).toBe(0);
    expect(report.totalProjectCost).toBe(0);
    expect(report.confidenceSummary.overallConfidence).toBe(0);
  });

  test('handles lines with no code', () => {
    const report = generateBOQReport(PROJECT_ID, [{ qty: 10, rate: 5 }], DEFAULT_OHP, 1.0, 'ON', 0.13, PROJECT_NAME);
    expect(report.lines.length).toBe(0); // Skips lines without code
  });

  test('handles zero regional factor gracefully', () => {
    const report = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 0, 'None', 0, PROJECT_NAME);
    expect(report.directCost).toBe(0);
    expect(report.totalProjectCost).toBe(0);
  });

  test('handles zero OH&P rates', () => {
    const report = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, { overhead: 0, profit: 0, contingency: 0 }, 1.0, 'ON', 0, PROJECT_NAME);
    expect(report.overheadAmount).toBe(0);
    expect(report.profitAmount).toBe(0);
    expect(report.contingencyAmount).toBe(0);
    expect(report.taxAmount).toBe(0);
    expect(report.totalProjectCost).toBe(report.directCost);
  });

  test('bid-leveling works with zero-cost trades', () => {
    const boq = generateBOQReport(PROJECT_ID, [
      { code: '033000-SLAB', description: 'Slab', unit: 'm\u00B3', qty: 0, rate: 0, elementIds: [], evidenceRefs: [], storey: 'L1' },
    ], DEFAULT_OHP, 1.0, 'ON', 0.13, PROJECT_NAME);
    const sheet = generateBidLevelingSheet(boq, PROJECT_NAME);
    expect(sheet.tradePackages.length).toBeGreaterThanOrEqual(0);
  });

  test('clash report handles null/undefined fields', () => {
    const report = generateClashReport(PROJECT_ID, {
      clashes: [
        { severity: null, category: null, elementAId: null },
        {},
      ],
    }, PROJECT_NAME);
    expect(report.clashes.length).toBe(2);
  });

  test('executive summary without optional modules', () => {
    const boq = generateBOQReport(PROJECT_ID, SAMPLE_ESTIMATE_LINES, DEFAULT_OHP, 1.0, 'ON', 0.13, PROJECT_NAME);
    const summary = generateExecutiveSummary(PROJECT_ID, PROJECT_NAME, boq, null, null, null);
    expect(summary.riskSummary.clashesFound).toBe(0);
    expect(summary.confidenceAnalysis.monteCarloP50).toBeNull();
  });
});
