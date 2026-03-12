/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RASTER GLYPH LOCATOR — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { detectRasterSymbolsForModel } from '../raster-glyph-locator';

describe('raster-glyph-locator.ts', () => {
  test('detectRasterSymbolsForModel function exists', () => {
    expect(typeof detectRasterSymbolsForModel).toBe('function');
  });

  test('returns a promise', () => {
    const result = detectRasterSymbolsForModel('test-model');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
