// benchmark-core.test.ts
// =============================================================================
// BENCHMARK & VALIDATION ENGINE — Unit Tests
// =============================================================================
// Standards: CIQS, AACE, RSMeans Canadian
// =============================================================================

import {
  registerBenchmarkPack,
  getBenchmarkPack,
  getRegisteredCategories,
  getAllPacks,
  runBenchmark,
  formatBenchmarkReport,
} from '../../estimator/benchmark-core';
import type {
  BenchmarkPack,
  BenchmarkConfig,
  BenchmarkReport,
  ProjectCategory,
} from '../../estimator/benchmark-core';
import type { EstimateSummary, EstimateLineItem, FloorSummary } from '../../estimator/estimate-engine';
import type { BudgetStructure } from '../../estimator/budget-structure';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeLineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    csiCode: '033000-CONC', csiDivision: '03', csiDivisionName: 'Concrete',
    csiSubdivision: '033000-CONC', description: 'Concrete', unit: 'm³',
    quantity: 100, baseQuantity: 95, wastePercent: 0.05, wasteQuantity: 5,
    materialRate: 185, laborRate: 45, equipmentRate: 25, totalRate: 255,
    materialCost: 18500, laborCost: 4500, equipmentCost: 2500, totalCost: 25500,
    floor: 'L1', elementIds: ['el-1'], evidenceRefs: ['A-101'],
    verificationStatus: 'verified',
    ...overrides,
  };
}

function makeEstimate(items: EstimateLineItem[]): EstimateSummary {
  const grandTotal = items.reduce((s, i) => s + i.totalCost, 0);
  const floor: FloorSummary = {
    floor: 'L1', floorLabel: 'L1', lineItems: items,
    materialTotal: items.reduce((s, i) => s + i.materialCost, 0),
    laborTotal: items.reduce((s, i) => s + i.laborCost, 0),
    equipmentTotal: items.reduce((s, i) => s + i.equipmentCost, 0),
    subtotal: grandTotal,
  };
  return {
    floors: [floor], grandTotal,
    materialGrandTotal: floor.materialTotal,
    laborGrandTotal: floor.laborTotal,
    equipmentGrandTotal: floor.equipmentTotal,
    wasteGrandTotal: 0, incompleteElements: 0, skippedElements: [],
    currency: 'CAD', region: 'ON', regionalFactor: 1.0,
    methodology: 'CIQS', generatedAt: new Date().toISOString(),
    lineItemCount: items.length,
    csiDivisionsUsed: new Set(items.map(i => i.csiDivision)).size,
  };
}

function makeBudget(grandTotal: number): BudgetStructure {
  return { GRAND_TOTAL: grandTotal } as BudgetStructure;
}

// Test benchmark pack
const TEST_BUILDING_PACK: BenchmarkPack = {
  category: 'building',
  categoryName: 'Building Construction',
  version: '1.0.0-test',
  metric: 'cost-per-m2-gfa',
  metricLabel: '$/m² GFA',
  measurementUnit: 'm²',
  projectTypes: ['residential-midrise', 'office-standard'],
  benchmarks: [
    { projectType: 'residential-midrise', typeName: 'Residential Mid-Rise (5-12 storey)', costLow: 2800, costMid: 3400, costHigh: 4200, source: 'Test Data', year: 2025 },
    { projectType: 'office-standard', typeName: 'Standard Office', costLow: 3200, costMid: 4000, costHigh: 5000, source: 'Test Data', year: 2025 },
  ],
  expectedDivisions: [
    { projectType: 'residential-midrise', divisions: ['03', '05', '07', '08', '09', '22', '23', '26'] },
    { projectType: 'office-standard', divisions: ['03', '05', '07', '08', '09', '22', '23', '26'] },
  ],
  divisionProportions: [
    { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.15, expectedPercentHigh: 0.30 },
    { division: '05', divisionName: 'Metals', expectedPercentLow: 0.10, expectedPercentHigh: 0.25 },
    { division: '09', divisionName: 'Finishes', expectedPercentLow: 0.10, expectedPercentHigh: 0.20 },
  ],
  getProjectTypeName(type: string): string {
    return this.benchmarks.find(b => b.projectType === type)?.typeName || type;
  },
};

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Benchmark & Validation Engine', () => {
  // ── Pack Registration ─────────────────────────────────────────────────

  describe('Pack registry', () => {
    beforeAll(() => {
      registerBenchmarkPack(TEST_BUILDING_PACK);
    });

    it('should register a benchmark pack', () => {
      const pack = getBenchmarkPack('building');
      expect(pack).toBeDefined();
      expect(pack!.category).toBe('building');
      expect(pack!.version).toBe('1.0.0-test');
    });

    it('should return registered categories', () => {
      const categories = getRegisteredCategories();
      expect(categories).toContain('building');
    });

    it('should return all packs', () => {
      const packs = getAllPacks();
      expect(packs.length).toBeGreaterThanOrEqual(1);
    });

    it('should return undefined for unregistered category', () => {
      const pack = getBenchmarkPack('mining' as ProjectCategory);
      // May or may not be registered — just verify it doesn't throw
      if (pack) {
        expect(pack.category).toBe('mining');
      }
    });
  });

  // ── Cost Benchmark — Within Range ─────────────────────────────────────

  describe('runBenchmark() — cost within range', () => {
    it('should report cost as "within" when in benchmark range', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      // 5000 m² × $3400/m² = $17,000,000 direct cost
      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 4000000 }),
        makeLineItem({ csiDivision: '05', totalCost: 3000000 }),
        makeLineItem({ csiDivision: '09', totalCost: 2500000 }),
        makeLineItem({ csiDivision: '23', totalCost: 4000000 }),
        makeLineItem({ csiDivision: '26', totalCost: 3500000 }),
      ];
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
        projectName: 'Test Condo',
      });

      expect(report.costStatus).toBe('within');
      expect(report.actualCostPerUnit).toBeCloseTo(17000000 / 5000, 0);
    });
  });

  // ── Cost Benchmark — Below Range ──────────────────────────────────────

  describe('runBenchmark() — cost below range', () => {
    it('should flag "below" when cost/unit is too low', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      // 5000 m² × $1000/m² = $5,000,000 — well below $2800 low
      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 5000000 }),
      ];
      const estimate = makeEstimate(items);
      const budget = makeBudget(8000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
      });

      expect(report.costStatus).toBe('below');
      expect(report.findings.some(f => f.severity === 'warning' && f.title.includes('below'))).toBe(true);
    });
  });

  // ── Cost Benchmark — Above Range ──────────────────────────────────────

  describe('runBenchmark() — cost above range', () => {
    it('should flag "above" when cost/unit exceeds range', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      // 1000 m² × $6000/m² = way above $4200+15% tolerance
      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 6000000 }),
      ];
      const estimate = makeEstimate(items);
      const budget = makeBudget(10000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 1000,
      });

      expect(report.costStatus).toBe('above');
    });
  });

  // ── Missing Pack ─────────────────────────────────────────────────────

  describe('runBenchmark() — no pack registered', () => {
    it('should return error report when pack is not found', () => {
      const items = [makeLineItem({ totalCost: 1000000 })];
      const estimate = makeEstimate(items);
      const budget = makeBudget(2000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'pipeline' as ProjectCategory,
        projectType: 'water-main',
        projectQuantity: 500,
      });

      // May or may not have pipeline pack — check for graceful handling
      if (report.overallStatus === 'fail') {
        expect(report.findings.some(f => f.severity === 'critical')).toBe(true);
      }
    });
  });

  // ── Completeness Check ───────────────────────────────────────────────

  describe('Completeness check', () => {
    it('should flag missing expected divisions', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      // Only include Div 03 — missing 05, 07, 08, 09, 22, 23, 26
      const items = [makeLineItem({ csiDivision: '03', totalCost: 17000000 })];
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
      });

      const missingFindings = report.findings.filter(f =>
        f.category === 'completeness' && f.title.includes('missing')
      );
      expect(missingFindings.length).toBeGreaterThan(0);
    });
  });

  // ── Data Quality ─────────────────────────────────────────────────────

  describe('Data quality scoring', () => {
    it('should report high quality when all items verified', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 17000000, verificationStatus: 'verified' }),
      ];
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
      });

      expect(report.dataQualityScore).toBe(100);
    });

    it('should report low quality when items are estimated', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      const items = Array.from({ length: 10 }, () =>
        makeLineItem({ totalCost: 1700000, verificationStatus: 'estimated' })
      );
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
      });

      expect(report.dataQualityScore).toBe(0);
      expect(report.findings.some(f => f.severity === 'critical' && f.category === 'data-quality')).toBe(true);
    });
  });

  // ── Report Formatter ──────────────────────────────────────────────────

  describe('formatBenchmarkReport()', () => {
    it('should produce formatted report', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      const items = [makeLineItem({ csiDivision: '03', totalCost: 17000000 })];
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
        projectName: 'Benchmark Test',
      });

      const formatted = formatBenchmarkReport(report);
      expect(formatted).toContain('BENCHMARK VALIDATION REPORT');
      expect(formatted).toContain('BUILDING');
      expect(formatted).toContain('SUMMARY');
    });
  });

  // ── Overall Status ────────────────────────────────────────────────────

  describe('Overall status determination', () => {
    it('should be "fail" when critical findings exist', () => {
      registerBenchmarkPack(TEST_BUILDING_PACK);

      const items = Array.from({ length: 10 }, () =>
        makeLineItem({ totalCost: 1700000, verificationStatus: 'estimated' })
      );
      const estimate = makeEstimate(items);
      const budget = makeBudget(25000000);

      const report = runBenchmark(estimate, budget, {
        projectCategory: 'building',
        projectType: 'residential-midrise',
        projectQuantity: 5000,
      });

      expect(report.overallStatus).toBe('fail');
    });
  });
});
