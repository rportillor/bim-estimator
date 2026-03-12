/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RASTER LEGEND ASSOC — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { detectRoundSymbolsFromRasters } from '../raster-legend-assoc';

describe('raster-legend-assoc.ts', () => {
  test('detectRoundSymbolsFromRasters function exists', () => {
    expect(typeof detectRoundSymbolsFromRasters).toBe('function');
  });

  test('returns a promise', () => {
    const result = detectRoundSymbolsFromRasters('test-project');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('accepts maxPages parameter', () => {
    const result = detectRoundSymbolsFromRasters('test-project', 3);
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
