/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM POSTPROCESS — Test Suite
 *  Tests: export functions exist
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { postprocessAndSave, postprocessAndSaveBIM, postprocessAndSaveBIM_LEGACY } from '../bim-postprocess';

describe('bim-postprocess.ts', () => {
  test('postprocessAndSave function exists', () => {
    expect(typeof postprocessAndSave).toBe('function');
  });

  test('postprocessAndSaveBIM function exists', () => {
    expect(typeof postprocessAndSaveBIM).toBe('function');
  });

  test('postprocessAndSaveBIM_LEGACY function exists', () => {
    expect(typeof postprocessAndSaveBIM_LEGACY).toBe('function');
  });
});
