// labor-burden.test.ts
// =============================================================================
// LABOR BURDEN CALCULATOR — Unit Tests
// =============================================================================
// Standards: Ontario ESA, CRA payroll, WSIB rate groups, CIQS labor costing
// =============================================================================

import {
  calculateLoadedRate,
  calculateCrewRate,
  generateLaborBurdenSummary,
  formatLaborBurdenReport,
  STATUTORY_BURDENS_ON_2025,
  TRADE_RATES_ON_2025,
} from '../../estimator/labor-burden';
import type {
  TradeRate,
  LoadedLaborRate,
  CrewComposition,
  StatutoryBurden,
} from '../../estimator/labor-burden';

// ─── Test Data ──────────────────────────────────────────────────────────────

const CARPENTER_TRADE: TradeRate = {
  tradeCode: 'CARP',
  tradeName: 'Carpenter',
  baseWageHourly: 42.75,
  isUnion: true,
  unionLocal: 'Carpenters 27',
  wsibRateGroup: '764',
  wsibRate: 4.86,
  productivityFactor: 0.85,
  fringeBenefits: [
    { name: 'Health & Welfare', type: 'hourly', rate: 4.50 },
    { name: 'Pension', type: 'hourly', rate: 5.80 },
    { name: 'Training', type: 'hourly', rate: 0.85 },
    { name: 'Industry Fund', type: 'hourly', rate: 0.50 },
  ],
};

const _ELECTRICIAN_TRADE: TradeRate = {
  tradeCode: 'ELEC',
  tradeName: 'Electrician',
  baseWageHourly: 48.25,
  isUnion: true,
  unionLocal: 'IBEW 353',
  wsibRateGroup: '707',
  wsibRate: 2.35,
  productivityFactor: 0.80,
  fringeBenefits: [
    { name: 'Health & Welfare', type: 'hourly', rate: 4.85 },
    { name: 'Pension', type: 'hourly', rate: 6.50 },
    { name: 'Training', type: 'hourly', rate: 1.10 },
    { name: 'Industry Fund', type: 'hourly', rate: 0.55 },
  ],
};

// ─── Helper ─────────────────────────────────────────────────────────────────

function _round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Labor Burden Calculator', () => {
  // ── Pre-populated Data ──────────────────────────────────────────────────

  describe('Pre-populated Ontario 2025 data', () => {
    it('should export statutory burden constants', () => {
      expect(STATUTORY_BURDENS_ON_2025).toBeDefined();
      expect(Array.isArray(STATUTORY_BURDENS_ON_2025)).toBe(true);
      expect(STATUTORY_BURDENS_ON_2025.length).toBeGreaterThanOrEqual(5);
    });

    it('should export trade rate constants', () => {
      expect(TRADE_RATES_ON_2025).toBeDefined();
      expect(Array.isArray(TRADE_RATES_ON_2025)).toBe(true);
      expect(TRADE_RATES_ON_2025.length).toBeGreaterThanOrEqual(10);
    });

    it('should include CPP2 at 5.95%', () => {
      const cpp = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'CPP2');
      expect(cpp).toBeDefined();
      expect(cpp!.rate).toBe(0.0595);
      expect(cpp!.annualMaximum).toBeDefined();
    });

    it('should include EI at 2.282%', () => {
      const ei = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'EI');
      expect(ei).toBeDefined();
      expect(ei!.rate).toBe(0.02282);
    });

    it('should include EHT at 1.95%', () => {
      const eht = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'EHT');
      expect(eht).toBeDefined();
      expect(eht!.rate).toBe(0.0195);
      expect(eht!.employerOnly).toBe(true);
    });

    it('should include Vacation Pay at 4%', () => {
      const vac = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'Vacation Pay');
      expect(vac).toBeDefined();
      expect(vac!.rate).toBe(0.04);
    });

    it('should include WSIB with rate=0 (applied per trade)', () => {
      const wsib = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'WSIB');
      expect(wsib).toBeDefined();
      expect(wsib!.rate).toBe(0);
      expect(wsib!.employerOnly).toBe(true);
    });

    it('should include Public Holidays at 3.6%', () => {
      const ph = STATUTORY_BURDENS_ON_2025.find(s => s.name === 'Public Holidays');
      expect(ph).toBeDefined();
      expect(ph!.rate).toBe(0.036);
    });

    it('all trades should have positive base wage', () => {
      for (const trade of TRADE_RATES_ON_2025) {
        expect(trade.baseWageHourly).toBeGreaterThan(0);
      }
    });

    it('all trades should have valid productivity factor (0 < pf <= 1)', () => {
      for (const trade of TRADE_RATES_ON_2025) {
        expect(trade.productivityFactor).toBeGreaterThan(0);
        expect(trade.productivityFactor).toBeLessThanOrEqual(1);
      }
    });

    it('all trades should have WSIB rate > 0', () => {
      for (const trade of TRADE_RATES_ON_2025) {
        expect(trade.wsibRate).toBeGreaterThan(0);
      }
    });
  });

  // ── calculateLoadedRate ────────────────────────────────────────────────

  describe('calculateLoadedRate()', () => {
    let result: LoadedLaborRate;

    beforeAll(() => {
      result = calculateLoadedRate(CARPENTER_TRADE, STATUTORY_BURDENS_ON_2025);
    });

    it('should return correct trade code and name', () => {
      expect(result.tradeCode).toBe('CARP');
      expect(result.tradeName).toBe('Carpenter');
    });

    it('should set base wage correctly', () => {
      expect(result.baseWage).toBe(42.75);
    });

    it('should calculate statutory burden > 0', () => {
      expect(result.statutoryBurden).toBeGreaterThan(0);
    });

    it('should calculate WSIB using trade-specific rate', () => {
      // WSIB for carpenter: baseWage * (wsibRate / 100) = 42.75 * (4.86 / 100) = 2.077...
      const wsibItem = result.breakdown.find(b => b.item.includes('WSIB'));
      expect(wsibItem).toBeDefined();
      expect(wsibItem!.amount).toBeCloseTo(42.75 * 4.86 / 100, 1);
    });

    it('should calculate fringe burden from hourly rates', () => {
      // H&W: 4.50, Pension: 5.80, Training: 0.85, Industry: 0.50 = 11.65
      expect(result.fringeBurden).toBeCloseTo(11.65, 1);
    });

    it('should have totalBurden = statutory + fringe', () => {
      expect(result.totalBurden).toBeCloseTo(result.statutoryBurden + result.fringeBurden, 1);
    });

    it('should have loadedRate = baseWage + totalBurden', () => {
      expect(result.loadedRate).toBeCloseTo(result.baseWage + result.totalBurden, 1);
    });

    it('should have effectiveRate = loadedRate / productivityFactor', () => {
      const expected = result.loadedRate / CARPENTER_TRADE.productivityFactor;
      expect(result.effectiveRate).toBeCloseTo(expected, 0);
    });

    it('effective rate should be higher than loaded rate (since productivity < 1)', () => {
      expect(result.effectiveRate).toBeGreaterThan(result.loadedRate);
    });

    it('should have burdenPercent > 0', () => {
      expect(result.burdenPercent).toBeGreaterThan(0);
      // Typical burden ~50-70% for Ontario union trades
      expect(result.burdenPercent).toBeGreaterThan(30);
      expect(result.burdenPercent).toBeLessThan(100);
    });

    it('should produce breakdown items', () => {
      expect(result.breakdown.length).toBeGreaterThan(0);
      // At least: CPP2, EI, WSIB, EHT, Vacation, Public Holidays + 4 fringe
      expect(result.breakdown.length).toBeGreaterThanOrEqual(8);
    });

    it('should handle zero base wage gracefully', () => {
      const zeroTrade: TradeRate = {
        ...CARPENTER_TRADE,
        baseWageHourly: 0,
      };
      const zeroResult = calculateLoadedRate(zeroTrade, STATUTORY_BURDENS_ON_2025);
      expect(zeroResult.baseWage).toBe(0);
      expect(zeroResult.burdenPercent).toBe(0);
      expect(zeroResult.loadedRate).toBeGreaterThanOrEqual(0);
    });

    it('should handle percent-type fringe benefits', () => {
      const percentTrade: TradeRate = {
        ...CARPENTER_TRADE,
        fringeBenefits: [
          { name: 'Custom Percent', type: 'percent', rate: 0.10 }, // 10% of base wage
        ],
      };
      const r = calculateLoadedRate(percentTrade, STATUTORY_BURDENS_ON_2025);
      const pctFringe = r.breakdown.find(b => b.item === 'Custom Percent');
      expect(pctFringe).toBeDefined();
      expect(pctFringe!.amount).toBeCloseTo(42.75 * 0.10, 1);
    });

    it('should handle monthly-type fringe benefits', () => {
      const monthlyTrade: TradeRate = {
        ...CARPENTER_TRADE,
        fringeBenefits: [
          { name: 'Monthly Benefit', type: 'monthly', rate: 500 }, // $500/month
        ],
      };
      const r = calculateLoadedRate(monthlyTrade, STATUTORY_BURDENS_ON_2025);
      const monthFringe = r.breakdown.find(b => b.item === 'Monthly Benefit');
      expect(monthFringe).toBeDefined();
      // 500 / 173.33 ≈ 2.88
      expect(monthFringe!.amount).toBeCloseTo(500 / 173.33, 1);
    });
  });

  // ── calculateCrewRate ─────────────────────────────────────────────────

  describe('calculateCrewRate()', () => {
    it('should calculate blended crew rate for a concrete crew', () => {
      const loadedRates = [
        calculateLoadedRate(CARPENTER_TRADE, STATUTORY_BURDENS_ON_2025),
        calculateLoadedRate(
          TRADE_RATES_ON_2025.find(t => t.tradeCode === 'LAB-GEN')!,
          STATUTORY_BURDENS_ON_2025
        ),
      ];

      const concreteCrew: CrewComposition = {
        crewId: 'CONC-CREW-01',
        crewName: 'Concrete Crew',
        members: [
          { tradeCode: 'CARP', count: 2, hoursPerDay: 8 },
          { tradeCode: 'LAB-GEN', count: 4, hoursPerDay: 8 },
        ],
        equipmentCostPerDay: 500,
      };

      const result = calculateCrewRate(concreteCrew, loadedRates);

      expect(result.crewId).toBe('CONC-CREW-01');
      expect(result.crewName).toBe('Concrete Crew');
      expect(result.totalMembersCount).toBe(6);
      expect(result.dailyCost).toBeGreaterThan(0);
      expect(result.hourlyCost).toBeCloseTo(result.dailyCost / 8, 0);
      expect(result.laborOnlyCost).toBe(result.dailyCost - 500);
      expect(result.equipmentCost).toBe(500);
      expect(result.memberBreakdown.length).toBe(2);
    });

    it('should skip unknown trade codes gracefully', () => {
      const loadedRates = [
        calculateLoadedRate(CARPENTER_TRADE, STATUTORY_BURDENS_ON_2025),
      ];
      const crew: CrewComposition = {
        crewId: 'TEST',
        crewName: 'Test Crew',
        members: [
          { tradeCode: 'CARP', count: 1, hoursPerDay: 8 },
          { tradeCode: 'UNKNOWN', count: 1, hoursPerDay: 8 },
        ],
      };
      const result = calculateCrewRate(crew, loadedRates);
      expect(result.totalMembersCount).toBe(1); // Only CARP counted
      expect(result.memberBreakdown.length).toBe(1);
    });

    it('should handle crew with no equipment cost', () => {
      const loadedRates = [
        calculateLoadedRate(CARPENTER_TRADE, STATUTORY_BURDENS_ON_2025),
      ];
      const crew: CrewComposition = {
        crewId: 'TEST',
        crewName: 'No Equipment',
        members: [{ tradeCode: 'CARP', count: 1, hoursPerDay: 8 }],
      };
      const result = calculateCrewRate(crew, loadedRates);
      expect(result.equipmentCost).toBe(0);
      expect(result.dailyCost).toBe(result.laborOnlyCost);
    });
  });

  // ── generateLaborBurdenSummary ─────────────────────────────────────────

  describe('generateLaborBurdenSummary()', () => {
    it('should generate default Ontario 2025 summary', () => {
      const summary = generateLaborBurdenSummary();

      expect(summary.province).toBe('Ontario');
      expect(summary.year).toBe(2025);
      expect(summary.statutoryBurdens.length).toBeGreaterThanOrEqual(5);
      expect(summary.tradeRates.length).toBeGreaterThanOrEqual(10);
      expect(summary.averageBurdenPercent).toBeGreaterThan(30);
      expect(summary.generatedAt).toBeDefined();
    });

    it('should compute totalStatutoryPercent excluding WSIB', () => {
      const summary = generateLaborBurdenSummary();
      // CPP2 (5.95%) + EI (2.282%) + EHT (1.95%) + Vacation (4%) + Public Holidays (3.6%) = 17.782%
      expect(summary.totalStatutoryPercent).toBeCloseTo(17.78, 0);
    });

    it('should include crew rates when provided', () => {
      const crews: CrewComposition[] = [
        {
          crewId: 'TEST-CREW',
          crewName: 'Test Crew',
          members: [
            { tradeCode: 'CARP', count: 2, hoursPerDay: 8 },
            { tradeCode: 'LAB-GEN', count: 2, hoursPerDay: 8 },
          ],
          equipmentCostPerDay: 200,
        },
      ];
      const summary = generateLaborBurdenSummary(undefined, undefined, crews);
      expect(summary.crewRates.length).toBe(1);
      expect(summary.crewRates[0].crewName).toBe('Test Crew');
    });

    it('should accept custom trades and statutory overrides', () => {
      const customTrades: TradeRate[] = [CARPENTER_TRADE];
      const customStatutory: StatutoryBurden[] = [
        { name: 'CustomTax', description: 'Test', rate: 0.10, basis: 'gross-wages', employerOnly: true },
      ];
      const summary = generateLaborBurdenSummary(customTrades, customStatutory);
      expect(summary.tradeRates.length).toBe(1);
      expect(summary.statutoryBurdens.length).toBe(1);
    });
  });

  // ── formatLaborBurdenReport ───────────────────────────────────────────

  describe('formatLaborBurdenReport()', () => {
    it('should produce a non-empty string report', () => {
      const summary = generateLaborBurdenSummary();
      const report = formatLaborBurdenReport(summary);
      expect(report).toBeDefined();
      expect(report.length).toBeGreaterThan(100);
      expect(report).toContain('LABOR BURDEN ANALYSIS');
      expect(report).toContain('Ontario');
      expect(report).toContain('Loaded Rates by Trade');
    });
  });

  // ── Cross-validation with CIQS standards ─────────────────────────────

  describe('CIQS standard compliance', () => {
    it('loaded rates should be in reasonable range for Ontario ICI', () => {
      const summary = generateLaborBurdenSummary();
      for (const rate of summary.tradeRates) {
        // Ontario union trades: loaded rates typically $50-$90/hr
        expect(rate.loadedRate).toBeGreaterThan(40);
        expect(rate.loadedRate).toBeLessThan(100);
      }
    });

    it('effective rates should be higher than loaded rates (all trades have productivity < 1)', () => {
      const summary = generateLaborBurdenSummary();
      for (const rate of summary.tradeRates) {
        expect(rate.effectiveRate).toBeGreaterThanOrEqual(rate.loadedRate);
      }
    });

    it('electrician should have lower WSIB than ironworker (rate group difference)', () => {
      const summary = generateLaborBurdenSummary();
      const elec = summary.tradeRates.find(r => r.tradeCode === 'ELEC')!;
      const iron = summary.tradeRates.find(r => r.tradeCode === 'IRON')!;
      // ELEC wsibRate: 2.35, IRON wsibRate: 6.12
      const elecWsib = elec.breakdown.find(b => b.item.includes('WSIB'))!.amount;
      const ironWsib = iron.breakdown.find(b => b.item.includes('WSIB'))!.amount;
      expect(elecWsib).toBeLessThan(ironWsib);
    });
  });
});
