// rate-variants.test.ts
// =============================================================================
// RATE VARIANTS — THREE-POINT ESTIMATION — Unit Tests
// =============================================================================
// Standards: AACE RP 18R-97, CIQS estimating practices
// Three-Point PERT: (Low + 4×Mid + High) / 6
// Standard Deviation: σ = (High - Low) / 6
// =============================================================================

import {
  getVarianceFactor,
  generateRateVariants,
  formatRateVariantReport,
  DIVISION_VARIANCE_FACTORS,
  type RateVariantSummary,
  type DivisionVarianceFactor,
} from '../../estimator/rate-variants';
import type { EstimateSummary, EstimateLineItem, FloorSummary } from '../../estimator/estimate-engine';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeLineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    csiCode: '033000-CONC', csiDivision: '03', csiDivisionName: 'Concrete',
    csiSubdivision: '033000-CONC', description: 'Concrete work', unit: 'm³',
    quantity: 100, baseQuantity: 95, wastePercent: 0.05, wasteQuantity: 5,
    materialRate: 185, laborRate: 45, equipmentRate: 25, totalRate: 255,
    materialCost: 18500, laborCost: 4500, equipmentCost: 2500, totalCost: 25500,
    floor: 'L1', elementIds: ['el-1'], evidenceRefs: [],
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

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Rate Variants — Three-Point Estimation', () => {
  // ── Division Variance Factors ────────────────────────────────────────

  describe('DIVISION_VARIANCE_FACTORS', () => {
    it('should define variance factors for major divisions', () => {
      expect(DIVISION_VARIANCE_FACTORS.length).toBeGreaterThan(15);
    });

    it('all factors should have lowFactor < 1 and highFactor > 1', () => {
      for (const factor of DIVISION_VARIANCE_FACTORS) {
        expect(factor.lowFactor).toBeLessThan(1);
        expect(factor.highFactor).toBeGreaterThan(1);
      }
    });

    it('earthwork (Div 31) should have highest volatility range', () => {
      const earthwork = DIVISION_VARIANCE_FACTORS.find(f => f.csiDivision === '31');
      expect(earthwork).toBeDefined();
      expect(earthwork!.volatility).toBe('high');
      expect(earthwork!.lowFactor).toBeLessThanOrEqual(0.80);
      expect(earthwork!.highFactor).toBeGreaterThanOrEqual(1.40);
    });

    it('conveying (Div 14) should have low volatility', () => {
      const conveying = DIVISION_VARIANCE_FACTORS.find(f => f.csiDivision === '14');
      expect(conveying).toBeDefined();
      expect(conveying!.volatility).toBe('low');
    });
  });

  // ── getVarianceFactor ────────────────────────────────────────────────

  describe('getVarianceFactor()', () => {
    it('should return defined factor for known division', () => {
      const factor = getVarianceFactor('03');
      expect(factor.csiDivision).toBe('03');
      expect(factor.divisionName).toBe('Concrete');
      expect(factor.lowFactor).toBe(0.90);
      expect(factor.highFactor).toBe(1.15);
    });

    it('should return default factor for unknown division', () => {
      const factor = getVarianceFactor('99');
      expect(factor.csiDivision).toBe('99');
      expect(factor.lowFactor).toBe(0.90);
      expect(factor.highFactor).toBe(1.15);
      expect(factor.volatility).toBe('medium');
    });
  });

  // ── generateRateVariants — Basic ─────────────────────────────────────

  describe('generateRateVariants()', () => {
    let result: RateVariantSummary;

    beforeAll(() => {
      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 500000, totalRate: 255, quantity: 1960.78 }),
        makeLineItem({ csiDivision: '05', csiDivisionName: 'Metals', totalCost: 300000, totalRate: 6.20, quantity: 48387 }),
        makeLineItem({ csiDivision: '09', csiDivisionName: 'Finishes', totalCost: 200000, totalRate: 32, quantity: 6250 }),
      ];
      result = generateRateVariants(makeEstimate(items));
    });

    it('should return low < mid < high totals', () => {
      expect(result.lowTotal).toBeLessThan(result.midTotal);
      expect(result.midTotal).toBeLessThan(result.highTotal);
    });

    it('midTotal should match input grandTotal', () => {
      expect(result.midTotal).toBe(1000000);
    });

    it('PERT total should satisfy formula: (L + 4M + H) / 6', () => {
      const expected = (result.lowTotal + 4 * result.midTotal + result.highTotal) / 6;
      expect(result.pertTotal).toBeCloseTo(expected, 0);
    });

    it('standard deviation should satisfy σ = (H - L) / 6', () => {
      const expected = (result.highTotal - result.lowTotal) / 6;
      expect(result.standardDeviation).toBeCloseTo(expected, 0);
    });

    it('estimate range percent should be > 0', () => {
      expect(result.estimateRangePercent).toBeGreaterThan(0);
    });

    it('68% confidence interval should be PERT ± 1σ', () => {
      expect(result.confidenceInterval68.low).toBeCloseTo(result.pertTotal - result.standardDeviation, 0);
      expect(result.confidenceInterval68.high).toBeCloseTo(result.pertTotal + result.standardDeviation, 0);
    });

    it('95% confidence interval should be PERT ± 2σ', () => {
      expect(result.confidenceInterval95.low).toBeCloseTo(result.pertTotal - 2 * result.standardDeviation, 0);
      expect(result.confidenceInterval95.high).toBeCloseTo(result.pertTotal + 2 * result.standardDeviation, 0);
    });

    it('should produce line items for each input line item', () => {
      expect(result.lineItems.length).toBe(3);
    });

    it('should produce division summary sorted by spread descending', () => {
      expect(result.divisionSummary.length).toBe(3);
      for (let i = 1; i < result.divisionSummary.length; i++) {
        expect(result.divisionSummary[i - 1].spread).toBeGreaterThanOrEqual(result.divisionSummary[i].spread);
      }
    });
  });

  // ── Per-Line Item Math ───────────────────────────────────────────────

  describe('Per-line item PERT calculation', () => {
    it('each line item should have low < mid < high', () => {
      const items = [makeLineItem({ csiDivision: '03', totalCost: 100000, totalRate: 255, quantity: 392 })];
      const result = generateRateVariants(makeEstimate(items));

      for (const li of result.lineItems) {
        expect(li.lowCost).toBeLessThan(li.midCost);
        expect(li.midCost).toBeLessThan(li.highCost);
      }
    });

    it('line item PERT = (lowCost + 4*midCost + highCost) / 6', () => {
      const items = [makeLineItem({ csiDivision: '05', totalCost: 300000, totalRate: 6.20, quantity: 48387 })];
      const result = generateRateVariants(makeEstimate(items));

      const li = result.lineItems[0];
      const expected = (li.lowCost + 4 * li.midCost + li.highCost) / 6;
      expect(li.pertCost).toBeCloseTo(expected, 0);
    });

    it('line item std dev = (highCost - lowCost) / 6', () => {
      const items = [makeLineItem({ csiDivision: '09', totalCost: 200000, totalRate: 32, quantity: 6250 })];
      const result = generateRateVariants(makeEstimate(items));

      const li = result.lineItems[0];
      const expected = (li.highCost - li.lowCost) / 6;
      expect(li.standardDeviation).toBeCloseTo(expected, 0);
    });

    it('quantity should use item.quantity (with waste) for all variants', () => {
      const items = [makeLineItem({ quantity: 100, totalRate: 255, totalCost: 25500, csiDivision: '03' })];
      const result = generateRateVariants(makeEstimate(items));

      const li = result.lineItems[0];
      expect(li.quantity).toBe(100);
      // lowCost = quantity * lowRate
      const factor = getVarianceFactor('03');
      expect(li.lowRate).toBeCloseTo(255 * factor.lowFactor, 1);
      expect(li.lowCost).toBeCloseTo(100 * li.lowRate, 0);
    });
  });

  // ── Custom Variance Factors ──────────────────────────────────────────

  describe('Custom variance factors', () => {
    it('should use custom factors when provided', () => {
      const customFactors: DivisionVarianceFactor[] = [
        { csiDivision: '03', divisionName: 'Concrete', lowFactor: 0.70, highFactor: 1.50, volatility: 'high' },
      ];
      const items = [makeLineItem({ csiDivision: '03', totalCost: 1000000, totalRate: 255, quantity: 3921 })];
      const result = generateRateVariants(makeEstimate(items), customFactors);

      // With custom 0.70-1.50 range, the spread should be wider than default
      // Note: generateRateVariants uses the custom array as a lookup, but falls back
      // to getVarianceFactor() for divisions not in the custom array — so the result
      // depends on which divisions' items contribute most
      expect(result.estimateRangePercent).toBeGreaterThan(20);
    });
  });

  // ── Report Formatter ──────────────────────────────────────────────────

  describe('formatRateVariantReport()', () => {
    it('should produce formatted report', () => {
      const items = [
        makeLineItem({ csiDivision: '03', totalCost: 500000, totalRate: 255, quantity: 1960 }),
        makeLineItem({ csiDivision: '05', csiDivisionName: 'Metals', totalCost: 300000, totalRate: 6.20, quantity: 48387 }),
      ];
      const result = generateRateVariants(makeEstimate(items));
      const report = formatRateVariantReport(result);

      expect(report).toContain('THREE-POINT ESTIMATE ANALYSIS');
      expect(report).toContain('Low (optimistic)');
      expect(report).toContain('Mid (most likely)');
      expect(report).toContain('High (pessimistic)');
      expect(report).toContain('PERT expected');
      expect(report).toContain('68% confidence');
      expect(report).toContain('95% confidence');
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle single line item', () => {
      const items = [makeLineItem({ totalCost: 100000, totalRate: 255, quantity: 392 })];
      const result = generateRateVariants(makeEstimate(items));

      expect(result.lineItems.length).toBe(1);
      expect(result.lowTotal).toBeLessThan(result.highTotal);
    });

    it('should handle empty estimate', () => {
      const estimate = makeEstimate([]);
      estimate.grandTotal = 0;
      const result = generateRateVariants(estimate);

      expect(result.midTotal).toBe(0);
      expect(result.lineItems.length).toBe(0);
    });
  });
});
