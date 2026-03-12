// budget-structure.test.ts
// =============================================================================
// BUDGET LAYER STRUCTURE — Unit Tests
// =============================================================================
// Standards: AACE RP 18R-97, CIQS, CSI MasterFormat 2018
// 8-Tier Professional Estimate: Direct → GC → Design → Allow → Contingency → Escalation → Permits → OH&P+Tax
// =============================================================================

import {
  buildBudgetStructure,
  formatBudgetSummary,
} from '../../estimator/budget-structure';
import type {
  BudgetConfig,
  BudgetStructure,
  AllowanceItem,
  RiskItem,
  EscalationConfig,
} from '../../estimator/budget-structure';
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

function makeEstimate(grandTotal: number = 1000000, opts: Partial<EstimateSummary> = {}): EstimateSummary {
  const item = makeLineItem({ totalCost: grandTotal });
  const floor: FloorSummary = {
    floor: 'Level 1',
    floorLabel: 'Level 1',
    lineItems: [item],
    materialTotal: grandTotal * 0.55,
    laborTotal: grandTotal * 0.35,
    equipmentTotal: grandTotal * 0.10,
    subtotal: grandTotal,
  };

  return {
    floors: [floor],
    grandTotal,
    materialGrandTotal: grandTotal * 0.55,
    laborGrandTotal: grandTotal * 0.35,
    equipmentGrandTotal: grandTotal * 0.10,
    wasteGrandTotal: grandTotal * 0.03,
    incompleteElements: 0,
    skippedElements: [],
    currency: 'CAD',
    region: 'ON',
    regionalFactor: 1.0,
    methodology: 'CIQS',
    generatedAt: new Date().toISOString(),
    lineItemCount: 1,
    csiDivisionsUsed: 1,
    ...opts,
  };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Budget Structure (8-Tier Professional Estimate)', () => {
  // ── Basic Structure ──────────────────────────────────────────────────

  describe('buildBudgetStructure() — defaults', () => {
    let budget: BudgetStructure;

    beforeAll(() => {
      budget = buildBudgetStructure(makeEstimate(1000000));
    });

    it('should return CAD currency and CIQS methodology', () => {
      expect(budget.currency).toBe('CAD');
      expect(budget.methodology).toBe('CIQS');
    });

    it('Layer 1: Direct cost should match estimate grandTotal', () => {
      expect(budget.directCost.subtotal).toBe(1000000);
    });

    it('Layer 2: General conditions should default to ~12% of direct', () => {
      expect(budget.generalConditions.subtotal).toBeCloseTo(1000000 * 0.12, -3);
      expect(budget.generalConditions.percentOfDirect).toBeCloseTo(0.12, 2);
    });

    it('Layer 2: GC breakdown should sum to subtotal', () => {
      const gc = budget.generalConditions;
      const sum = gc.siteManagement + gc.temporaryWorks + gc.HSE + gc.QA_QC + gc.logistics;
      expect(sum).toBeCloseTo(gc.subtotal, 0);
    });

    it('Layer 3: Design fees should default to ~10% of construction cost', () => {
      expect(budget.designFees.percentOfConstruction).toBeCloseTo(0.10, 2);
    });

    it('Layer 3: Design fee breakdown should have arch/struct/MEP/other', () => {
      const df = budget.designFees;
      expect(df.architectural).toBeGreaterThan(0);
      expect(df.structural).toBeGreaterThan(0);
      expect(df.MEP).toBeGreaterThan(0);
      expect(df.other).toBeGreaterThan(0);
    });

    it('Layer 4: Allowances should be empty by default', () => {
      expect(budget.allowances.items.length).toBe(0);
      expect(budget.allowances.subtotal).toBe(0);
    });

    it('Layer 5: Contingency should be class-based', () => {
      expect(budget.contingency.totalContingency).toBeGreaterThan(0);
      expect(budget.contingency.designContingency).toBeGreaterThan(0);
      expect(budget.contingency.constructionContingency).toBeGreaterThan(0);
      expect(budget.contingency.managementReserve).toBeGreaterThan(0);
    });

    it('Layer 6: Escalation should be computed', () => {
      expect(budget.escalation.compoundFactor).toBeGreaterThanOrEqual(1.0);
      expect(budget.escalation.amount).toBeGreaterThanOrEqual(0);
    });

    it('Layer 7: Permits should be computed', () => {
      expect(budget.permitsFees.subtotal).toBeGreaterThan(0);
      expect(budget.permitsFees.buildingPermit).toBeGreaterThan(0);
    });

    it('Layer 8: OH&P should be computed', () => {
      expect(budget.overheadProfit.subtotal).toBeGreaterThan(0);
      expect(budget.overheadProfit.homeOfficeOverhead).toBeGreaterThan(0);
      expect(budget.overheadProfit.profit).toBeGreaterThan(0);
      expect(budget.overheadProfit.bondInsurance).toBeGreaterThan(0);
    });

    it('Tax: HST should default to 13%', () => {
      expect(budget.taxes.rate).toBe(0.13);
      expect(budget.taxes.HST).toBeGreaterThan(0);
    });

    it('GRAND_TOTAL should be > direct cost (all layers add up)', () => {
      expect(budget.GRAND_TOTAL).toBeGreaterThan(budget.directCost.subtotal);
    });

    it('GRAND_TOTAL = totalWithOHP + taxes', () => {
      expect(budget.GRAND_TOTAL).toBeCloseTo(budget.totalWithOHP + budget.taxes.subtotal, 0);
    });

    it('constructionCost = direct + general conditions', () => {
      expect(budget.constructionCost).toBeCloseTo(
        budget.directCost.subtotal + budget.generalConditions.subtotal, 0
      );
    });
  });

  // ── AACE Classification ──────────────────────────────────────────────

  describe('AACE estimate classification', () => {
    it('should classify as Class 5 when all items are unverified', () => {
      const estimate = makeEstimate(1000000);
      estimate.floors[0].lineItems[0].verificationStatus = 'estimated';
      const budget = buildBudgetStructure(estimate);
      // 0% verified → Class 5
      expect(budget.aaceClass.estimateClass).toBe(5);
    });

    it('should classify as Class 1 when >65% items are verified', () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeLineItem({ totalCost: 100000, verificationStatus: i < 7 ? 'verified' : 'estimated' })
      );
      const floor: FloorSummary = {
        floor: 'L1', floorLabel: 'L1', lineItems: items,
        materialTotal: 550000, laborTotal: 350000, equipmentTotal: 100000, subtotal: 1000000,
      };
      const estimate: EstimateSummary = {
        ...makeEstimate(1000000),
        floors: [floor],
        lineItemCount: 10,
      };

      const budget = buildBudgetStructure(estimate);
      expect(budget.aaceClass.estimateClass).toBe(1);
      expect(budget.aaceClass.scopeMaturity).toBe(70);
    });

    it('higher class should have lower contingency range', () => {
      // Class 1 contingency should be lower than Class 5
      const class1Item = makeLineItem({ verificationStatus: 'verified', totalCost: 1000000 });
      const class5Item = makeLineItem({ verificationStatus: 'estimated', totalCost: 1000000 });

      const est1: EstimateSummary = { ...makeEstimate(1000000), floors: [{ floor: 'L1', floorLabel: 'L1', lineItems: [class1Item], materialTotal: 550000, laborTotal: 350000, equipmentTotal: 100000, subtotal: 1000000 }] };
      const est5: EstimateSummary = { ...makeEstimate(1000000), floors: [{ floor: 'L1', floorLabel: 'L1', lineItems: [class5Item], materialTotal: 550000, laborTotal: 350000, equipmentTotal: 100000, subtotal: 1000000 }] };

      const budget1 = buildBudgetStructure(est1);
      const budget5 = buildBudgetStructure(est5);

      expect(budget1.contingency.percentOfBase).toBeLessThan(budget5.contingency.percentOfBase);
    });
  });

  // ── Custom Configuration ──────────────────────────────────────────────

  describe('Custom budget configuration', () => {
    it('should apply custom GC percentage', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        generalConditionsPercent: 0.15,
      });
      expect(budget.generalConditions.subtotal).toBeCloseTo(1000000 * 0.15, -3);
    });

    it('should apply duration-based general conditions', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        projectDurationMonths: 12,
      });
      // Duration-based: 12 * (18500 + 4200 + 3500 + 2800 + 3000) = 12 * 32000 = 384000
      expect(budget.generalConditions.subtotal).toBeCloseTo(384000, -2);
    });

    it('should apply custom design fee percentage', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        designFeesPercent: 0.15,
      });
      expect(budget.designFees.percentOfConstruction).toBe(0.15);
    });

    it('should include allowances', () => {
      const allowances: AllowanceItem[] = [
        { id: 'A-01', description: 'IT Allowance', scope: 'Per drawings', amount: 50000, basis: 'client directive', linkedCSI: ['27'] },
      ];
      const budget = buildBudgetStructure(makeEstimate(1000000), { allowances });
      expect(budget.allowances.items.length).toBe(1);
      expect(budget.allowances.subtotal).toBe(50000);
    });

    it('should include risk register in contingency', () => {
      const riskRegister: RiskItem[] = [
        { id: 'R-01', description: 'Soil contamination', category: 'scope', probability: 0.3, impactLow: 50000, impactHigh: 150000, expectedValue: 30000, mitigationNotes: 'Phase II ESA', affectedCSI: ['02'] },
      ];
      const budget = buildBudgetStructure(makeEstimate(1000000), { riskRegister });
      expect(budget.contingency.riskRegister.length).toBe(1);
      // Risk expected value should increase construction contingency
      expect(budget.contingency.constructionContingency).toBeGreaterThan(0);
    });

    it('should apply custom tax rate', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), { taxRate: 0.05 });
      expect(budget.taxes.rate).toBe(0.05);
    });

    it('should apply custom overhead/profit/bond percentages', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        overheadPercent: 0.08,
        profitPercent: 0.10,
        bondInsurancePercent: 0.03,
      });
      // Sum should be 21% of base before OH&P
      expect(budget.overheadProfit.percentOfConstruction).toBeCloseTo(0.21, 1);
    });

    it('should apply custom permit/fees overrides', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        permitsFees: {
          buildingPermit: 25000,
          developmentCharges: 10000,
          planReview: 5000,
          inspections: 3000,
        },
      });
      expect(budget.permitsFees.buildingPermit).toBe(25000);
      expect(budget.permitsFees.subtotal).toBe(43000);
    });
  });

  // ── Escalation ────────────────────────────────────────────────────────

  describe('Escalation calculation', () => {
    it('should have escalation factor >= 1 for future construction', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000));
      expect(budget.escalation.compoundFactor).toBeGreaterThanOrEqual(1.0);
    });

    it('should have escalation = 0 when base date = midpoint', () => {
      const today = new Date().toISOString().split('T')[0];
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        escalation: {
          priceBaseDate: today,
          estimateBaseDate: today,
          constructionMidPoint: today,
          annualEscalationRate: 0.03,
          materialEscalation: 0.035,
          laborEscalation: 0.025,
        },
      });
      expect(budget.escalation.amount).toBeCloseTo(0, 0);
      expect(budget.escalation.compoundFactor).toBeCloseTo(1.0, 2);
    });
  });

  // ── Report Formatter ──────────────────────────────────────────────────

  describe('formatBudgetSummary()', () => {
    it('should produce complete report', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000), {
        projectName: 'Test Project Alpha',
      });
      const report = formatBudgetSummary(budget);

      expect(report).toContain('PROFESSIONAL ESTIMATE SUMMARY');
      expect(report).toContain('Test Project Alpha');
      expect(report).toContain('LAYER 1');
      expect(report).toContain('LAYER 2');
      expect(report).toContain('LAYER 3');
      expect(report).toContain('LAYER 5');
      expect(report).toContain('LAYER 6');
      expect(report).toContain('LAYER 7');
      expect(report).toContain('LAYER 8');
      expect(report).toContain('GRAND TOTAL');
      expect(report).toContain('HST');
    });
  });

  // ── Arithmetic Integrity ──────────────────────────────────────────────

  describe('Arithmetic integrity', () => {
    it('GRAND_TOTAL should equal sum of all layers + tax', () => {
      const budget = buildBudgetStructure(makeEstimate(1000000));

      const computed = budget.directCost.subtotal
        + budget.generalConditions.subtotal
        + budget.designFees.subtotal
        + budget.allowances.subtotal
        + budget.contingency.totalContingency
        + budget.escalation.amount
        + budget.permitsFees.subtotal
        + budget.overheadProfit.subtotal
        + budget.taxes.subtotal;

      expect(budget.GRAND_TOTAL).toBeCloseTo(computed, 0);
    });

    it('constructionCost should be Layer 1 + Layer 2', () => {
      const budget = buildBudgetStructure(makeEstimate(500000));
      expect(budget.constructionCost).toBeCloseTo(
        budget.directCost.subtotal + budget.generalConditions.subtotal, 0
      );
    });
  });
});
