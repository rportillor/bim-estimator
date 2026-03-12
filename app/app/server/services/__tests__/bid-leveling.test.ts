// bid-leveling.test.ts
// =============================================================================
// BID LEVELING & TENDER RECONCILIATION — Unit Tests
// =============================================================================
// Standards: CCDC 23, AACE RP 30R-03, CIQS Standard Method
// =============================================================================

import {
  generateBidLeveling,
  formatBidLevelingReport,
} from '../../estimator/bid-leveling';
import type {
  BidPackage,
  BidLevelConfig,
  BidLevelingReport,
} from '../../estimator/bid-leveling';
import type { EstimateSummary, EstimateLineItem, FloorSummary } from '../../estimator/estimate-engine';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeLineItem(div: string, cost: number, divName: string = 'Division'): EstimateLineItem {
  return {
    csiCode: `${div}0000`, csiDivision: div, csiDivisionName: divName,
    csiSubdivision: `${div}0000`, description: `${divName} item`, unit: 'm²',
    quantity: cost / 100, baseQuantity: cost / 105, wastePercent: 0.05, wasteQuantity: cost / 2100,
    materialRate: 55, laborRate: 35, equipmentRate: 10, totalRate: 100,
    materialCost: cost * 0.55, laborCost: cost * 0.35, equipmentCost: cost * 0.10,
    totalCost: cost, floor: 'L1', elementIds: ['el-1'], evidenceRefs: [],
    verificationStatus: 'verified',
  };
}

function makeEstimate(divCosts: Record<string, number>): EstimateSummary {
  const items = Object.entries(divCosts).map(([div, cost]) => makeLineItem(div, cost));
  const grandTotal = items.reduce((s, i) => s + i.totalCost, 0);
  const floor: FloorSummary = {
    floor: 'L1', floorLabel: 'L1', lineItems: items,
    materialTotal: grandTotal * 0.55, laborTotal: grandTotal * 0.35,
    equipmentTotal: grandTotal * 0.10, subtotal: grandTotal,
  };
  return {
    floors: [floor], grandTotal,
    materialGrandTotal: grandTotal * 0.55, laborGrandTotal: grandTotal * 0.35,
    equipmentGrandTotal: grandTotal * 0.10, wasteGrandTotal: 0,
    incompleteElements: 0, skippedElements: [], currency: 'CAD',
    region: 'ON', regionalFactor: 1.0, methodology: 'CIQS',
    generatedAt: new Date().toISOString(), lineItemCount: items.length,
    csiDivisionsUsed: items.length,
  };
}

function makeBid(name: string, company: string, divAmounts: Record<string, number>, opts: Partial<BidPackage> = {}): BidPackage {
  const lineItems = Object.entries(divAmounts).map(([div, amount]) => ({
    csiDivision: div,
    description: `Div ${div} work`,
    amount,
  }));
  return {
    bidderName: name,
    bidderCompany: company,
    bidDate: '2025-06-01',
    totalBidAmount: lineItems.reduce((s, i) => s + i.amount, 0),
    lineItems,
    qualifications: [],
    bondIncluded: true,
    insuranceCertificate: true,
    addendaAcknowledged: ['Addendum 1', 'Addendum 2'],
    ...opts,
  };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Bid Leveling & Tender Reconciliation', () => {
  const engineerDivs = { '03': 500000, '05': 300000, '09': 200000, '23': 250000, '26': 150000 };
  const engineerEstimate = makeEstimate(engineerDivs);

  // ── Basic Bid Comparison ──────────────────────────────────────────────

  describe('generateBidLeveling() — basic', () => {
    it('should produce report with correct bid count', () => {
      const bids = [
        makeBid('Alpha', 'Alpha Corp', { '03': 480000, '05': 310000, '09': 190000, '23': 260000, '26': 155000 }),
        makeBid('Beta', 'Beta Ltd', { '03': 520000, '05': 280000, '09': 210000, '23': 240000, '26': 145000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.bidCount).toBe(2);
      expect(report.engineerEstimate).toBe(1400000);
      expect(report.methodology).toContain('CCDC 23');
    });

    it('should create division comparison matrix', () => {
      const bids = [
        makeBid('Alpha', 'Alpha Corp', { '03': 480000, '05': 310000, '09': 190000, '23': 260000, '26': 155000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.divisionMatrix.length).toBeGreaterThan(0);
      const div03 = report.divisionMatrix.find(d => d.csiDivision === '03');
      expect(div03).toBeDefined();
      expect(div03!.engineerEstimate).toBe(500000);
      expect(div03!.bidders[0].amount).toBe(480000);
    });

    it('should rank bidders by normalised amount', () => {
      const bids = [
        makeBid('Expensive', 'Exp Corp', { '03': 600000, '05': 400000, '09': 300000, '23': 350000, '26': 200000 }),
        makeBid('Cheap', 'Cheap Ltd', { '03': 450000, '05': 270000, '09': 180000, '23': 230000, '26': 130000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.bidderSummaries[0].ranking).toBe(1);
      expect(report.bidderSummaries[0].bidderName).toBe('Cheap');
      expect(report.bidderSummaries[1].ranking).toBe(2);
    });
  });

  // ── Scope Gap Detection ───────────────────────────────────────────────

  describe('Scope gap detection', () => {
    it('should detect missing division from bid', () => {
      // Bidder missing Div 26 entirely
      const bids = [
        makeBid('Incomplete', 'Inc Corp', { '03': 500000, '05': 300000, '09': 200000, '23': 250000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      const div26Gap = report.scopeGaps.find(g => g.csiDivision === '26' && g.gapType === 'missing-division');
      expect(div26Gap).toBeDefined();
      expect(div26Gap!.estimatedImpact).toBe(150000);
    });

    it('should detect partial scope (bidder amount < 50% of engineer)', () => {
      const bids = [
        makeBid('Partial', 'Part Corp', { '03': 200000, '05': 300000, '09': 200000, '23': 250000, '26': 150000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      const partialGaps = report.scopeGaps.filter(g => g.gapType === 'partial-scope');
      expect(partialGaps.length).toBeGreaterThan(0);
    });

    it('should detect explicit exclusions from qualifications', () => {
      const bids = [
        makeBid('Excluding', 'Excl Corp',
          { '03': 500000, '05': 300000, '09': 200000, '23': 250000, '26': 150000 },
          { qualifications: ['Excludes all HVAC work', 'Division 23 not included'] }
        ),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      const exclusionGaps = report.scopeGaps.filter(g => g.gapType === 'explicit-exclusion');
      expect(exclusionGaps.length).toBeGreaterThan(0);
    });
  });

  // ── Bid Normalisation ────────────────────────────────────────────────

  describe('Bid normalisation', () => {
    it('should add scope gap value to normalised amount', () => {
      const bids = [
        makeBid('Missing26', 'M26 Corp',
          { '03': 500000, '05': 300000, '09': 200000, '23': 250000 },
        ),
      ];
      const report = generateBidLeveling(engineerEstimate, bids, { normaliseBids: true });

      const summary = report.bidderSummaries[0];
      expect(summary.normalisedAmount).toBeGreaterThan(summary.totalBidAmount);
      expect(summary.scopeGapValue).toBe(150000);
    });

    it('should NOT normalise when disabled', () => {
      const bids = [
        makeBid('Missing26', 'M26 Corp',
          { '03': 500000, '05': 300000, '09': 200000, '23': 250000 },
        ),
      ];
      const report = generateBidLeveling(engineerEstimate, bids, { normaliseBids: false });

      const summary = report.bidderSummaries[0];
      expect(summary.normalisedAmount).toBe(summary.totalBidAmount);
    });
  });

  // ── Variance Flagging ────────────────────────────────────────────────

  describe('Variance flagging', () => {
    it('should flag divisions exceeding variance threshold', () => {
      const bids = [
        makeBid('Outlier', 'Out Corp', { '03': 800000, '05': 300000, '09': 200000, '23': 250000, '26': 150000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids, { varianceThreshold: 15 });

      const div03 = report.divisionMatrix.find(d => d.csiDivision === '03');
      expect(div03).toBeDefined();
      // 800k vs 500k = +60% → should be flagged
      expect(div03!.bidders[0].flagged).toBe(true);
    });

    it('should NOT flag divisions within threshold', () => {
      const bids = [
        makeBid('Close', 'Close Corp', { '03': 520000, '05': 300000, '09': 200000, '23': 250000, '26': 150000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids, { varianceThreshold: 15 });

      const div03 = report.divisionMatrix.find(d => d.csiDivision === '03');
      // 520k vs 500k = +4% → should not be flagged
      expect(div03!.bidders[0].flagged).toBe(false);
    });
  });

  // ── Recommendations ──────────────────────────────────────────────────

  describe('Recommendations', () => {
    it('should recommend lowest normalised bidder', () => {
      const bids = [
        makeBid('Alpha', 'Alpha Corp', { '03': 480000, '05': 290000, '09': 190000, '23': 240000, '26': 140000 }),
        makeBid('Beta', 'Beta Ltd', { '03': 520000, '05': 310000, '09': 210000, '23': 260000, '26': 160000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some(r => r.includes('Lowest'))).toBe(true);
    });

    it('should warn about missing bonds', () => {
      const bids = [
        makeBid('NoBond', 'NB Corp', { '03': 500000 }, { bondIncluded: false }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.recommendations.some(r => r.includes('Bond'))).toBe(true);
    });

    it('should warn about significant scope gaps', () => {
      const bids = [
        makeBid('Gaps', 'Gap Corp', { '03': 500000 }), // Missing 4 divisions
      ];
      const report = generateBidLeveling(engineerEstimate, bids);

      expect(report.recommendations.some(r => r.includes('scope gap'))).toBe(true);
    });
  });

  // ── Report Formatter ──────────────────────────────────────────────────

  describe('formatBidLevelingReport()', () => {
    it('should produce formatted report', () => {
      const bids = [
        makeBid('Alpha', 'Alpha Corp', { '03': 480000, '05': 290000, '09': 190000, '23': 240000, '26': 140000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);
      const formatted = formatBidLevelingReport(report);

      expect(formatted).toContain('BID LEVELING');
      expect(formatted).toContain('CCDC 23');
      expect(formatted).toContain('Bidder Ranking');
      expect(formatted).toContain('Division');
      expect(formatted).toContain('Alpha');
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle single bidder', () => {
      const bids = [
        makeBid('Solo', 'Solo Corp', { '03': 500000, '05': 300000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);
      expect(report.bidderSummaries.length).toBe(1);
      expect(report.bidderSummaries[0].ranking).toBe(1);
    });

    it('should handle bidder with extra divisions not in engineer estimate', () => {
      const bids = [
        makeBid('Extra', 'Extra Corp', { '03': 500000, '05': 300000, '09': 200000, '23': 250000, '26': 150000, '34': 50000 }),
      ];
      const report = generateBidLeveling(engineerEstimate, bids);
      // Division 34 should appear in the matrix
      const div34 = report.divisionMatrix.find(d => d.csiDivision === '34');
      expect(div34).toBeDefined();
    });
  });
});
