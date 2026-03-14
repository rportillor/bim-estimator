// rfi-generator.test.ts
// =============================================================================
// RFI WIRE — MISSING DATA → RFI GENERATION — Unit Tests
// =============================================================================
// Standards: CCDC 2 GC 2.2.8, CIQS documentation practices
// =============================================================================

import {
  registerMissingData,
  assessPriority,
  generateRFI,
  generateAllRFIs,
  generateRFISummary,
  formatRFIReport,
} from '../../estimator/rfi-generator';
import type {
  MissingDataItem,
  MissingDataCategory,
} from '../../estimator/rfi-generator';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMissingItem(overrides: Partial<MissingDataItem> = {}): MissingDataItem {
  return {
    id: 'MD-test-0001',
    category: 'dimension',
    description: 'Missing wall height for interior partition',
    csiDivision: '09',
    floorLabel: 'Level 2',
    impact: 'medium',
    costImpactLow: 5000,
    costImpactHigh: 15000,
    discoveredAt: new Date().toISOString(),
    discoveredBy: 'QS-Engine',
    ...overrides,
  };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('RFI Generator', () => {
  // ── registerMissingData ───────────────────────────────────────────────

  describe('registerMissingData()', () => {
    it('should create a missing data item with auto-generated ID', () => {
      const item = registerMissingData({
        category: 'dimension',
        description: 'Missing slab thickness',
        csiDivision: '03',
        impact: 'high',
        costImpactLow: 10000,
        costImpactHigh: 30000,
        discoveredBy: 'Engine',
      });

      expect(item.id).toMatch(/^MD-/);
      expect(item.discoveredAt).toBeDefined();
      expect(item.category).toBe('dimension');
      expect(item.description).toBe('Missing slab thickness');
    });

    it('should generate unique IDs for multiple items', () => {
      const item1 = registerMissingData({
        category: 'specification',
        description: 'Test 1',
        csiDivision: '03',
        impact: 'low',
        costImpactLow: 0,
        costImpactHigh: 0,
        discoveredBy: 'Test',
      });
      const item2 = registerMissingData({
        category: 'specification',
        description: 'Test 2',
        csiDivision: '03',
        impact: 'low',
        costImpactLow: 0,
        costImpactHigh: 0,
        discoveredBy: 'Test',
      });

      expect(item1.id).not.toBe(item2.id);
    });
  });

  // ── assessPriority ────────────────────────────────────────────────────

  describe('assessPriority()', () => {
    it('critical impact → urgent priority', () => {
      const item = makeMissingItem({ impact: 'critical' });
      expect(assessPriority(item)).toBe('urgent');
    });

    it('high impact → high priority', () => {
      const item = makeMissingItem({ impact: 'high' });
      expect(assessPriority(item)).toBe('high');
    });

    it('medium impact → normal priority', () => {
      const item = makeMissingItem({ impact: 'medium', category: 'dimension' });
      expect(assessPriority(item)).toBe('normal');
    });

    it('low impact → low priority', () => {
      const item = makeMissingItem({ impact: 'low' });
      expect(assessPriority(item)).toBe('low');
    });

    it('geotechnical category elevates to high priority', () => {
      const item = makeMissingItem({ impact: 'medium', category: 'geotechnical' });
      expect(assessPriority(item)).toBe('high');
    });

    it('code category elevates to high priority', () => {
      const item = makeMissingItem({ impact: 'medium', category: 'code' });
      expect(assessPriority(item)).toBe('high');
    });
  });

  // ── generateRFI ───────────────────────────────────────────────────────

  describe('generateRFI()', () => {
    it('should generate an RFI from a single missing data item', () => {
      const item = makeMissingItem({
        description: 'Missing concrete strength specification',
        drawingRef: 'S-301',
        specSection: '03 30 00',
      });

      const rfi = generateRFI([item], 'Test Project', 'QS Team', 1);

      expect(rfi.rfiId).toBe('RFI-001');
      expect(rfi.projectName).toBe('Test Project');
      expect(rfi.status).toBe('draft');
      expect(rfi.question).toContain('clarify');
      expect(rfi.drawingRefs).toContain('S-301');
      expect(rfi.specRefs).toContain('03 30 00');
      expect(rfi.costImpactLow).toBe(item.costImpactLow);
      expect(rfi.costImpactHigh).toBe(item.costImpactHigh);
      expect(rfi.missingDataIds).toContain(item.id);
    });

    it('should generate RFI from multiple items', () => {
      const items = [
        makeMissingItem({ description: 'Missing rebar size', csiDivision: '03' }),
        makeMissingItem({ description: 'Missing rebar spacing', csiDivision: '03', costImpactLow: 8000, costImpactHigh: 20000 }),
      ];

      const rfi = generateRFI(items, 'Project X', 'QS', 5);

      expect(rfi.rfiId).toBe('RFI-005');
      expect(rfi.question).toContain('1.');
      expect(rfi.question).toContain('2.');
      expect(rfi.costImpactLow).toBe(13000); // 5000 + 8000
      expect(rfi.costImpactHigh).toBe(35000); // 15000 + 20000
      expect(rfi.missingDataIds.length).toBe(2);
    });

    it('should throw on empty items array', () => {
      expect(() => generateRFI([], 'Project', 'QS', 1)).toThrow();
    });

    it('should set priority based on primary item impact', () => {
      const criticalItem = makeMissingItem({ impact: 'critical' });
      const rfi = generateRFI([criticalItem], 'Project', 'QS', 1);
      expect(rfi.priority).toBe('urgent');
    });

    it('should link back to missing data items', () => {
      const item = makeMissingItem();
      expect(item.rfiId).toBeUndefined();

      generateRFI([item], 'Project', 'QS', 1);
      expect(item.rfiId).toBe('RFI-001');
    });

    it('background should include cost impact range', () => {
      const item = makeMissingItem({ costImpactLow: 10000, costImpactHigh: 50000 });
      const rfi = generateRFI([item], 'Project', 'QS', 1);
      expect(rfi.background).toContain('10,000');
      expect(rfi.background).toContain('50,000');
    });

    it('should collect unique drawing and spec references', () => {
      const items = [
        makeMissingItem({ drawingRef: 'A-101', specSection: '09 29 00' }),
        makeMissingItem({ drawingRef: 'A-101', specSection: '09 51 00' }),
        makeMissingItem({ drawingRef: 'A-201' }),
      ];
      const rfi = generateRFI(items, 'P', 'QS', 1);
      expect(rfi.drawingRefs.length).toBe(2); // A-101 deduplicated
      expect(rfi.specRefs.length).toBe(2);
    });
  });

  // ── generateAllRFIs ───────────────────────────────────────────────────

  describe('generateAllRFIs()', () => {
    it('should group items by category + CSI division', () => {
      const items = [
        makeMissingItem({ category: 'dimension', csiDivision: '03' }),
        makeMissingItem({ category: 'dimension', csiDivision: '03' }),
        makeMissingItem({ category: 'specification', csiDivision: '09' }),
        makeMissingItem({ category: 'material', csiDivision: '05' }),
      ];

      const rfis = generateAllRFIs(items, 'Project', 'QS');

      // 3 groups: dimension|03, specification|09, material|05
      expect(rfis.length).toBe(3);
    });

    it('should sort RFIs by priority (urgent first)', () => {
      const items = [
        makeMissingItem({ impact: 'low', category: 'dimension', csiDivision: '09' }),
        makeMissingItem({ impact: 'critical', category: 'code', csiDivision: '21' }),
        makeMissingItem({ impact: 'medium', category: 'specification', csiDivision: '03' }),
      ];

      const rfis = generateAllRFIs(items, 'Project', 'QS');
      expect(rfis[0].priority).toBe('urgent');
    });

    it('should assign sequential RFI numbers', () => {
      const items = [
        makeMissingItem({ category: 'dimension', csiDivision: '03' }),
        makeMissingItem({ category: 'specification', csiDivision: '09' }),
      ];

      const rfis = generateAllRFIs(items, 'Project', 'QS');
      const ids = rfis.map(r => r.rfiId);
      expect(ids).toContain('RFI-001');
      expect(ids).toContain('RFI-002');
    });
  });

  // ── generateRFISummary ────────────────────────────────────────────────

  describe('generateRFISummary()', () => {
    it('should produce complete summary', () => {
      const items = [
        makeMissingItem({ impact: 'critical', costImpactLow: 50000, costImpactHigh: 100000 }),
        makeMissingItem({ impact: 'medium', costImpactLow: 5000, costImpactHigh: 10000 }),
      ];
      const rfis = generateAllRFIs(items, 'Project', 'QS');
      const summary = generateRFISummary(items, rfis, 'Project');

      expect(summary.totalMissingItems).toBe(2);
      expect(summary.totalRFIs).toBe(rfis.length);
      expect(summary.totalCostUncertaintyLow).toBe(55000);
      expect(summary.totalCostUncertaintyHigh).toBe(110000);
      expect(summary.criticalItems.length).toBe(1);
      expect(summary.rfisByStatus.draft).toBe(rfis.length);
    });
  });

  // ── formatRFIReport ───────────────────────────────────────────────────

  describe('formatRFIReport()', () => {
    it('should produce formatted report string', () => {
      const items = [
        makeMissingItem({ impact: 'critical', description: 'Missing foundation depth' }),
        makeMissingItem({ impact: 'medium', description: 'Unclear paint finish spec' }),
      ];
      const rfis = generateAllRFIs(items, 'Test Project', 'QS');
      const summary = generateRFISummary(items, rfis, 'Test Project');
      const report = formatRFIReport(summary);

      expect(report).toContain('RFI REGISTER');
      expect(report).toContain('Test Project');
      expect(report).toContain('CRITICAL ITEMS');
      expect(report).toContain('Missing foundation depth');
      expect(report).toContain('RFI-');
    });
  });

  // ── All MissingDataCategory values ────────────────────────────────────

  describe('Category coverage', () => {
    const categories: MissingDataCategory[] = [
      'dimension', 'specification', 'detail', 'material', 'quantity',
      'code', 'coordination', 'geotechnical', 'environmental', 'schedule',
    ];

    for (const cat of categories) {
      it(`should handle category: ${cat}`, () => {
        const item = registerMissingData({
          category: cat,
          description: `Test ${cat} item`,
          csiDivision: '03',
          impact: 'medium',
          costImpactLow: 1000,
          costImpactHigh: 5000,
          discoveredBy: 'Test',
        });
        expect(item.category).toBe(cat);

        const rfi = generateRFI([item], 'Project', 'QS', 1);
        expect(rfi.category).toBe(cat);
        expect(rfi.subject).toContain(cat.charAt(0).toUpperCase());
      });
    }
  });
});
