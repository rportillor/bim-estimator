/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM FACADE — Test Suite
 *  Tests: BIM export object, GenerateOpts type
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { BIM } from '../bim-facade';
import type { GenerateOpts } from '../bim-facade';

describe('BIM facade', () => {
  test('BIM object is defined', () => {
    expect(BIM).toBeDefined();
  });

  test('BIM has generate method', () => {
    expect(typeof BIM.generate).toBe('function');
  });

  test('GenerateOpts type compliance', () => {
    const opts: GenerateOpts = {
      projectId: 'MOOR-001',
      modelId: 'model-001',
      unitSystem: 'metric',
      analysis: { storeys: 3, building_analysis: {} },
    };
    expect(opts.projectId).toBe('MOOR-001');
    expect(opts.unitSystem).toBe('metric');
  });
});
