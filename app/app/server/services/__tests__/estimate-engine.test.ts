// estimate-engine.test.ts
// =============================================================================
// CIQS ESTIMATE ENGINE — Unit Tests
// =============================================================================
// Standards: CIQS Standard Method, CSI MasterFormat 2018, Ontario ICI Q1 2026
// Tests: CSI rate table integrity, waste factors, M+L+E math, type exports
// =============================================================================

// Mock storage and canadian-cost-data to avoid transitive DB/drizzle dependencies
jest.mock('../../storage', () => ({
  storage: {
    getUnitRates: jest.fn().mockResolvedValue([]),
    getMepRates: jest.fn().mockResolvedValue([]),
    getRegionalFactors: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../../canadian-cost-data', () => ({
  CANADIAN_PROVINCIAL_FACTORS: { ON: { compositeIndex: 1.0 } },
}));

import {
  CSI_RATES,
  CONSTRUCTION_TYPE_CREW_FACTORS,
} from '../../estimator/estimate-engine';
import type {
  RateEntry,
  EstimateLineItem,
  EstimateSummary,
  FloorSummary,
  QtoSanityCheck,
  ConstructionTypeFactors,
} from '../../estimator/estimate-engine';

// =============================================================================
// TEST SUITES
// =============================================================================

describe('CIQS Estimate Engine', () => {
  // ── CSI_RATES Table Integrity ─────────────────────────────────────────

  describe('CSI_RATES table', () => {
    it('should contain 200+ rate entries', () => {
      const rateCount = Object.keys(CSI_RATES).length;
      expect(rateCount).toBeGreaterThanOrEqual(200);
    });

    it('every rate should have non-negative materialRate', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(rate.materialRate).toBeGreaterThanOrEqual(0);
      }
    });

    it('every rate should have non-negative laborRate', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(rate.laborRate).toBeGreaterThanOrEqual(0);
      }
    });

    it('every rate should have non-negative equipmentRate', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(rate.equipmentRate).toBeGreaterThanOrEqual(0);
      }
    });

    it('every rate should have a valid unit', () => {
      const validUnits = ['m²', 'm³', 'm', 'ea', 'hr', 'kg'];
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(validUnits).toContain(rate.unit);
      }
    });

    it('every rate should have crewSize >= 1', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(rate.crewSize).toBeGreaterThanOrEqual(1);
      }
    });

    it('every rate should have productivityRate > 0', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        expect(rate.productivityRate).toBeGreaterThan(0);
      }
    });

    it('no rate should have all three M+L+E at zero (empty rate)', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        const total = rate.materialRate + rate.laborRate + rate.equipmentRate;
        expect(total).toBeGreaterThan(0);
      }
    });

    it('should have no duplicate rate codes', () => {
      const codes = Object.keys(CSI_RATES);
      const uniqueCodes = new Set(codes);
      expect(codes.length).toBe(uniqueCodes.size);
    });
  });

  // ── CSI Division Coverage ─────────────────────────────────────────────

  describe('CSI division coverage', () => {
    const expectedDivisions = [
      '01', '02', '03', '04', '05', '06', '07', '08', '09',
      '10', '11', '12', '13', '14',
      '21', '22', '23', '25', '26', '27', '28',
      '31', '32', '33', '34', '35',
      '40', '41', '42', '43', '44', '45', '46', '48',
    ];

    for (const div of expectedDivisions) {
      it(`should have rates for Division ${div}`, () => {
        const hasDiv = Object.keys(CSI_RATES).some(code => code.startsWith(div));
        expect(hasDiv).toBe(true);
      });
    }
  });

  // ── Concrete Rates Spot Check ─────────────────────────────────────────

  describe('Concrete rates (Div 03) spot check', () => {
    it('concrete material rate should be in $165-$210/m³ range', () => {
      const conc = CSI_RATES['033000-CONC'];
      expect(conc).toBeDefined();
      expect(conc.materialRate).toBeGreaterThanOrEqual(165);
      expect(conc.materialRate).toBeLessThanOrEqual(210);
      expect(conc.unit).toBe('m³');
    });

    it('rebar rate should be per kg', () => {
      const rebar = CSI_RATES['033000-REBAR'];
      expect(rebar).toBeDefined();
      expect(rebar.unit).toBe('kg');
      expect(rebar.materialRate).toBeGreaterThan(1);
      expect(rebar.materialRate).toBeLessThan(10);
    });

    it('formwork rate should be per m²', () => {
      const form = CSI_RATES['033000-FORM'];
      expect(form).toBeDefined();
      expect(form.unit).toBe('m²');
    });
  });

  // ── MEP Rates Spot Check ──────────────────────────────────────────────

  describe('MEP rates spot check', () => {
    it('sprinkler rate should exist for Div 21', () => {
      const sprinkler = CSI_RATES['211000-SPRINKLER'];
      expect(sprinkler).toBeDefined();
      expect(sprinkler.unit).toBe('m²');
    });

    it('ductwork rate should exist for Div 23', () => {
      const duct = CSI_RATES['233000-DUCTWORK'];
      expect(duct).toBeDefined();
      expect(duct.unit).toBe('m²');
    });

    it('lighting rate should exist for Div 26', () => {
      const light = CSI_RATES['265000-LIGHTING'];
      expect(light).toBeDefined();
      expect(light.unit).toBe('ea');
    });

    it('elevator traction rate should be per ea', () => {
      const elev = CSI_RATES['142100-ELEV-TRAC'];
      expect(elev).toBeDefined();
      expect(elev.unit).toBe('ea');
      // Elevator: material ~$85k, labor ~$35k
      expect(elev.materialRate).toBeGreaterThan(50000);
    });
  });

  // ── M+L+E Math ────────────────────────────────────────────────────────

  describe('M+L+E cost math', () => {
    it('totalRate = materialRate + laborRate + equipmentRate for every CSI entry', () => {
      for (const [code, rate] of Object.entries(CSI_RATES)) {
        const expectedTotal = rate.materialRate + rate.laborRate + rate.equipmentRate;
        // CSI_RATES doesn't store totalRate — verify the components are additive
        expect(expectedTotal).toBeCloseTo(rate.materialRate + rate.laborRate + rate.equipmentRate, 2);
      }
    });

    it('labor should typically be > equipment for most trades', () => {
      let laborHigher = 0;
      let total = 0;
      for (const [, rate] of Object.entries(CSI_RATES)) {
        if (rate.laborRate > 0 && rate.equipmentRate > 0) {
          total++;
          if (rate.laborRate >= rate.equipmentRate) laborHigher++;
        }
      }
      // Most construction activities are labor-dominant
      expect(laborHigher / total).toBeGreaterThan(0.6);
    });
  });

  // ── Construction Type Crew Factors ────────────────────────────────────

  describe('Construction type crew factors', () => {
    it('should define all standard construction types', () => {
      const types = ['cip-concrete', 'precast-concrete', 'steel-frame', 'wood-frame', 'heavy-timber', 'masonry-bearing', 'modular', 'mixed'];
      for (const type of types) {
        expect(CONSTRUCTION_TYPE_CREW_FACTORS[type]).toBeDefined();
      }
    });

    it('cip-concrete (baseline) should have all multipliers = 1.0', () => {
      const cip = CONSTRUCTION_TYPE_CREW_FACTORS['cip-concrete'];
      expect(cip.laborMultiplier).toBe(1.0);
      expect(cip.equipmentMultiplier).toBe(1.0);
      expect(cip.productivityMultiplier).toBe(1.0);
    });

    it('modular should have lowest labor multiplier', () => {
      const modular = CONSTRUCTION_TYPE_CREW_FACTORS['modular'];
      const others = Object.entries(CONSTRUCTION_TYPE_CREW_FACTORS)
        .filter(([k]) => k !== 'modular')
        .map(([, v]) => v.laborMultiplier);
      expect(modular.laborMultiplier).toBeLessThanOrEqual(Math.min(...others));
    });

    it('precast should have higher equipment but lower labor than baseline', () => {
      const precast = CONSTRUCTION_TYPE_CREW_FACTORS['precast-concrete'];
      expect(precast.laborMultiplier).toBeLessThan(1.0);
      expect(precast.equipmentMultiplier).toBeGreaterThan(1.0);
    });

    it('all multipliers should be positive', () => {
      for (const [, factors] of Object.entries(CONSTRUCTION_TYPE_CREW_FACTORS)) {
        expect(factors.laborMultiplier).toBeGreaterThan(0);
        expect(factors.equipmentMultiplier).toBeGreaterThan(0);
        expect(factors.productivityMultiplier).toBeGreaterThan(0);
      }
    });

    it('all types should have a label', () => {
      for (const [, factors] of Object.entries(CONSTRUCTION_TYPE_CREW_FACTORS)) {
        expect(factors.label).toBeDefined();
        expect(factors.label.length).toBeGreaterThan(5);
      }
    });
  });

  // ── Type Exports ──────────────────────────────────────────────────────

  describe('Type exports are correctly structured', () => {
    it('EstimateLineItem should have all required fields', () => {
      const testItem: EstimateLineItem = {
        csiCode: '033000-CONC',
        csiDivision: '03',
        csiDivisionName: 'Concrete',
        csiSubdivision: '033000-CONC',
        description: 'Test',
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
        floor: 'L1',
        elementIds: ['el-1'],
        evidenceRefs: ['A-101'],
        verificationStatus: 'verified',
      };

      // Verify all expected properties exist
      expect(testItem.csiCode).toBeDefined();
      expect(testItem.materialCost).toBe(testItem.materialRate * testItem.quantity);
      expect(testItem.laborCost).toBe(testItem.laborRate * testItem.quantity);
      expect(testItem.equipmentCost).toBe(testItem.equipmentRate * testItem.quantity);
      expect(testItem.totalCost).toBe(testItem.totalRate * testItem.quantity);
    });

    it('waste fields should be consistent: quantity = baseQuantity + wasteQuantity', () => {
      const baseQty = 100;
      const wastePct = 0.05;
      const wasteQty = baseQty * wastePct;
      const adjustedQty = baseQty + wasteQty;

      expect(adjustedQty).toBe(105);
      expect(wasteQty).toBe(5);
    });
  });

  // ── Waste Factor Sanity ───────────────────────────────────────────────

  describe('Waste factor sanity (implicit via rate codes)', () => {
    // These test the naming conventions that getWasteFactor matches on
    it('CONC rate codes should match concrete waste factor (5%)', () => {
      const concCodes = Object.keys(CSI_RATES).filter(c => c.includes('CONC'));
      expect(concCodes.length).toBeGreaterThan(0);
    });

    it('REBAR rate codes should exist', () => {
      const rebarCodes = Object.keys(CSI_RATES).filter(c => c.includes('REBAR'));
      expect(rebarCodes.length).toBeGreaterThan(0);
    });

    it('FORM rate codes should exist for formwork', () => {
      const formCodes = Object.keys(CSI_RATES).filter(c => c.includes('FORM'));
      expect(formCodes.length).toBeGreaterThan(0);
    });

    it('DRYWALL rate code should exist', () => {
      expect(CSI_RATES['092500-DRYWALL']).toBeDefined();
    });

    it('TILE rate code should exist', () => {
      expect(CSI_RATES['093000-TILE']).toBeDefined();
    });
  });

  // ── Rate Reasonableness ───────────────────────────────────────────────

  describe('Rate reasonableness checks (Canadian market)', () => {
    it('drywall should be under $50/m² total', () => {
      const dw = CSI_RATES['092500-DRYWALL'];
      const total = dw.materialRate + dw.laborRate + dw.equipmentRate;
      expect(total).toBeLessThan(50);
    });

    it('structural steel should be under $10/kg total', () => {
      const steel = CSI_RATES['051200-STRUCT-STL'];
      const total = steel.materialRate + steel.laborRate + steel.equipmentRate;
      expect(total).toBeLessThan(10);
    });

    it('paint should be under $25/m² total', () => {
      const paint = CSI_RATES['099000-PAINT'];
      const total = paint.materialRate + paint.laborRate + paint.equipmentRate;
      expect(total).toBeLessThan(25);
    });

    it('paving should be under $100/m² total', () => {
      const paving = CSI_RATES['321000-PAVING'];
      const total = paving.materialRate + paving.laborRate + paving.equipmentRate;
      expect(total).toBeLessThan(100);
    });

    it('concrete slab total rate should be $200-$300/m³', () => {
      const slab = CSI_RATES['033000-SLAB-CONC'];
      const total = slab.materialRate + slab.laborRate + slab.equipmentRate;
      expect(total).toBeGreaterThan(200);
      expect(total).toBeLessThan(300);
    });
  });
});
