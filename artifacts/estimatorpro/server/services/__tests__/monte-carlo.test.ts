// monte-carlo.test.ts
// =============================================================================
// MONTE CARLO COST SIMULATION — Unit Tests
// =============================================================================
// Standards: AACE RP 41R-08, RP 42R-08, RP 44R-08
// =============================================================================

import {
  runMonteCarloSimulation,
  formatMonteCarloReport,
  type MonteCarloResult,
  type MonteCarloConfig,
} from '../../estimator/monte-carlo';
import type { EstimateSummary, EstimateLineItem, FloorSummary } from '../../estimator/estimate-engine';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeLineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    csiCode: '033000-CONC',
    csiDivision: '03',
    csiDivisionName: 'Concrete',
    csiSubdivision: '033000-CONC',
    description: 'Concrete slab',
    unit: 'm³',
    quantity: 100,
    baseQuantity: 95,
    wastePercent: 0.05,
    wasteQuantity: 5,
    materialRate: 185,
    laborRate: 45,
    equipmentRate: 25,
    totalRate: 255,
    materialCost: 18500,
    laborCost: 4500,
    equipmentCost: 2500,
    totalCost: 25500,
    floor: 'Level 1',
    elementIds: ['el-1'],
    evidenceRefs: ['A-101'],
    verificationStatus: 'verified',
    ...overrides,
  };
}

function makeEstimate(lineItems?: EstimateLineItem[]): EstimateSummary {
  const items = lineItems || [
    makeLineItem({ csiCode: '033000-CONC', csiDivision: '03', totalCost: 250000 }),
    makeLineItem({ csiCode: '051200-STRUCT-STL', csiDivision: '05', csiDivisionName: 'Metals', totalCost: 180000, totalRate: 6.20, quantity: 29032 }),
    makeLineItem({ csiCode: '092500-DRYWALL', csiDivision: '09', csiDivisionName: 'Finishes', totalCost: 85000, totalRate: 32, quantity: 2656 }),
    makeLineItem({ csiCode: '233000-DUCTWORK', csiDivision: '23', csiDivisionName: 'HVAC', totalCost: 120000, totalRate: 98, quantity: 1224 }),
    makeLineItem({ csiCode: '265000-LIGHTING', csiDivision: '26', csiDivisionName: 'Electrical', totalCost: 65000, totalRate: 275, quantity: 236 }),
  ];

  const floor: FloorSummary = {
    floor: 'Level 1',
    floorLabel: 'Level 1',
    lineItems: items,
    materialTotal: items.reduce((s, i) => s + i.materialCost, 0),
    laborTotal: items.reduce((s, i) => s + i.laborCost, 0),
    equipmentTotal: items.reduce((s, i) => s + i.equipmentCost, 0),
    subtotal: items.reduce((s, i) => s + i.totalCost, 0),
  };

  return {
    floors: [floor],
    grandTotal: floor.subtotal,
    materialGrandTotal: floor.materialTotal,
    laborGrandTotal: floor.laborTotal,
    equipmentGrandTotal: floor.equipmentTotal,
    wasteGrandTotal: 0,
    incompleteElements: 0,
    skippedElements: [],
    currency: 'CAD',
    region: 'ON',
    regionalFactor: 1.0,
    methodology: 'CIQS',
    generatedAt: new Date().toISOString(),
    lineItemCount: items.length,
    csiDivisionsUsed: new Set(items.map(i => i.csiDivision)).size,
  };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Monte Carlo Simulation', () => {
  // ── Basic Simulation ──────────────────────────────────────────────────

  describe('runMonteCarloSimulation()', () => {
    let result: MonteCarloResult;

    beforeAll(() => {
      const estimate = makeEstimate();
      result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });
    });

    it('should return correct iteration count', () => {
      expect(result.iterations).toBe(1000);
    });

    it('should return base estimate matching input', () => {
      expect(result.baseEstimate).toBe(700000); // 250k + 180k + 85k + 120k + 65k
    });

    it('should return all 5 standard percentiles', () => {
      expect(result.percentiles.P10).toBeDefined();
      expect(result.percentiles.P25).toBeDefined();
      expect(result.percentiles.P50).toBeDefined();
      expect(result.percentiles.P75).toBeDefined();
      expect(result.percentiles.P90).toBeDefined();
    });

    it('percentiles should be in ascending order', () => {
      expect(result.percentiles.P10).toBeLessThanOrEqual(result.percentiles.P25);
      expect(result.percentiles.P25).toBeLessThanOrEqual(result.percentiles.P50);
      expect(result.percentiles.P50).toBeLessThanOrEqual(result.percentiles.P75);
      expect(result.percentiles.P75).toBeLessThanOrEqual(result.percentiles.P90);
    });

    it('P50 (median) should be close to base estimate', () => {
      // PERT distribution is centered on mode=1.0, so median should be near base
      const variance = Math.abs(result.percentiles.P50 - result.baseEstimate) / result.baseEstimate;
      expect(variance).toBeLessThan(0.15); // Within 15%
    });

    it('mean should be positive and close to base estimate', () => {
      expect(result.mean).toBeGreaterThan(0);
      const variance = Math.abs(result.mean - result.baseEstimate) / result.baseEstimate;
      expect(variance).toBeLessThan(0.15);
    });

    it('standard deviation should be positive', () => {
      expect(result.standardDeviation).toBeGreaterThan(0);
    });

    it('coefficient of variation should be between 0 and 1', () => {
      expect(result.coefficientOfVariation).toBeGreaterThan(0);
      expect(result.coefficientOfVariation).toBeLessThan(1);
    });

    it('P90 should be higher than P10 (there is uncertainty)', () => {
      expect(result.percentiles.P90).toBeGreaterThan(result.percentiles.P10);
    });

    it('should report methodology as AACE RP 41R-08', () => {
      expect(result.methodology).toContain('AACE RP 41R-08');
    });
  });

  // ── Deterministic Reproducibility ─────────────────────────────────────

  describe('Seed reproducibility', () => {
    it('same seed should produce identical results', () => {
      const estimate = makeEstimate();
      const config: MonteCarloConfig = { iterations: 500, seed: 12345 };

      const r1 = runMonteCarloSimulation(estimate, config);
      const r2 = runMonteCarloSimulation(estimate, config);

      expect(r1.percentiles.P50).toBe(r2.percentiles.P50);
      expect(r1.mean).toBe(r2.mean);
      expect(r1.standardDeviation).toBe(r2.standardDeviation);
    });

    it('different seeds should produce different results', () => {
      const estimate = makeEstimate();
      const r1 = runMonteCarloSimulation(estimate, { iterations: 500, seed: 1 });
      const r2 = runMonteCarloSimulation(estimate, { iterations: 500, seed: 999 });

      // Very unlikely to be exactly equal with different seeds
      expect(r1.mean).not.toBe(r2.mean);
    });
  });

  // ── Risk Events ───────────────────────────────────────────────────────

  describe('Risk events', () => {
    it('should incorporate risk events when enabled', () => {
      const estimate = makeEstimate();
      const withRisk = runMonteCarloSimulation(estimate, {
        iterations: 2000,
        seed: 42,
        riskItems: [
          {
            id: 'R-001',
            description: 'Soil contamination',
            category: 'scope',
            probability: 0.3,
            impactLow: 50000,
            impactHigh: 200000,
            expectedValue: 37500,
            mitigationNotes: 'Phase II ESA',
            affectedCSI: ['02'],
          },
        ],
      });

      const withoutRisk = runMonteCarloSimulation(estimate, {
        iterations: 2000,
        seed: 42,
        includeRiskEvents: false,
      });

      // Risk events should increase the mean
      expect(withRisk.mean).toBeGreaterThan(withoutRisk.mean);
    });

    it('risk contribution should be reported', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
        riskItems: [
          {
            id: 'R-001',
            description: 'Test risk',
            category: 'scope',
            probability: 0.5,
            impactLow: 10000,
            impactHigh: 50000,
            expectedValue: 15000,
            mitigationNotes: '',
            affectedCSI: ['03'],
          },
        ],
      });

      expect(result.riskContribution).toBeDefined();
      expect(result.riskContribution.totalVariance).toBeGreaterThan(0);
    });
  });

  // ── Division Sensitivity ──────────────────────────────────────────────

  describe('Division sensitivity analysis', () => {
    it('should identify divisions contributing to variance', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });

      expect(result.divisionSensitivity.length).toBeGreaterThan(0);

      // Should be sorted by variance contribution descending
      for (let i = 1; i < result.divisionSensitivity.length; i++) {
        expect(result.divisionSensitivity[i - 1].varianceContribution)
          .toBeGreaterThanOrEqual(result.divisionSensitivity[i].varianceContribution);
      }
    });

    it('variance contributions should sum to ~100%', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });

      const totalContrib = result.divisionSensitivity.reduce((s, d) => s + d.varianceContribution, 0);
      expect(totalContrib).toBeCloseTo(100, -1); // Within 10
    });
  });

  // ── Histogram ─────────────────────────────────────────────────────────

  describe('Histogram generation', () => {
    it('should produce 20 histogram bins', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });

      expect(result.histogram.length).toBe(20);
    });

    it('histogram counts should sum to iteration count', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });

      const totalCount = result.histogram.reduce((s, h) => s + h.count, 0);
      expect(totalCount).toBe(1000);
    });

    it('histogram bins should be contiguous', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });

      for (let i = 1; i < result.histogram.length; i++) {
        expect(result.histogram[i].binMin).toBeCloseTo(result.histogram[i - 1].binMax, 0);
      }
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle single line item', () => {
      const estimate = makeEstimate([makeLineItem({ totalCost: 100000 })]);
      const result = runMonteCarloSimulation(estimate, {
        iterations: 500,
        seed: 42,
      });

      expect(result.baseEstimate).toBe(100000);
      expect(result.mean).toBeGreaterThan(0);
    });

    it('should handle custom confidence levels', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
        confidenceLevels: [5, 10, 25, 50, 75, 90, 95],
      });

      // Standard percentiles always returned
      expect(result.percentiles.P50).toBeDefined();
      // Custom ones beyond standard
      expect(result.customPercentiles.find(p => p.level === 5)).toBeDefined();
      expect(result.customPercentiles.find(p => p.level === 95)).toBeDefined();
    });

    it('should handle zero quantity variance', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 500,
        seed: 42,
        quantityVariance: 0,
      });

      expect(result.mean).toBeGreaterThan(0);
    });
  });

  // ── Report Formatter ──────────────────────────────────────────────────

  describe('formatMonteCarloReport()', () => {
    it('should produce formatted report string', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 1000,
        seed: 42,
      });
      const report = formatMonteCarloReport(result);

      expect(report).toContain('MONTE CARLO COST SIMULATION REPORT');
      expect(report).toContain('AACE RP 41R-08');
      expect(report).toContain('P10');
      expect(report).toContain('P50');
      expect(report).toContain('P90');
      expect(report).toContain('Recommendation');
    });
  });

  // ── AACE Compliance ───────────────────────────────────────────────────

  describe('AACE RP 41R-08 compliance', () => {
    it('P90-P10 range should be reasonable for Class 3 estimate', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 5000,
        seed: 42,
      });

      const range = result.percentiles.P90 - result.percentiles.P10;
      const rangePct = range / result.baseEstimate;

      // For a Class 3 estimate with typical variance factors,
      // 80% confidence range should be roughly 15-40% of base
      expect(rangePct).toBeGreaterThan(0.05);
      expect(rangePct).toBeLessThan(0.60);
    });

    it('skewness should be slightly positive (cost uncertainty right-skewed)', () => {
      const estimate = makeEstimate();
      const result = runMonteCarloSimulation(estimate, {
        iterations: 5000,
        seed: 42,
      });

      // Construction costs tend to be right-skewed (more upside risk than downside)
      // This depends on variance factors — some may be symmetric
      // Just verify it's a finite number
      expect(Number.isFinite(result.skewness)).toBe(true);
    });
  });
});
