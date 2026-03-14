/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  TYPES (Re-export Barrel) — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import * as types from '../types';

describe('types.ts', () => {
  test('module loads without error', () => {
    expect(types).toBeDefined();
  });

  test('re-exports shared-types content', () => {
    const keys = Object.keys(types);
    expect(keys.length).toBeGreaterThan(0);
  });
});
