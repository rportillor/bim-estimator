/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  OCR — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { ocrImageBuffer } from '../ocr';

describe('ocr.ts', () => {
  test('ocrImageBuffer function exists', () => {
    expect(typeof ocrImageBuffer).toBe('function');
  });

  test('returns a promise', () => {
    const emptyBuffer = Buffer.from([]);
    const result = ocrImageBuffer(emptyBuffer);
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('accepts language parameter', () => {
    const buf = Buffer.from([]);
    const result = ocrImageBuffer(buf, 'fra');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
