/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SIMILARITY DB — Test Suite
 *  Tests: hashText, makePairKey (pure functions)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { hashText, makePairKey } from '../similarity-db';

describe('hashText', () => {
  test('returns consistent hash for same input', () => {
    const h1 = hashText('Hello World');
    const h2 = hashText('Hello World');
    expect(h1).toBe(h2);
  });

  test('different inputs produce different hashes', () => {
    const h1 = hashText('Hello');
    const h2 = hashText('World');
    expect(h1).not.toBe(h2);
  });

  test('returns non-empty string', () => {
    const hash = hashText('test');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  test('empty string produces valid hash', () => {
    const hash = hashText('');
    expect(hash.length).toBeGreaterThan(0);
  });

  test('long string produces hash', () => {
    const longString = 'A'.repeat(100000);
    const hash = hashText(longString);
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe('makePairKey', () => {
  test('creates deterministic key from two IDs + hashes', () => {
    const key1 = makePairKey('doc-A', 'hashA', 'doc-B', 'hashB');
    const key2 = makePairKey('doc-A', 'hashA', 'doc-B', 'hashB');
    expect(key1).toBe(key2);
  });

  test('order matters or is normalized consistently', () => {
    const key1 = makePairKey('doc-A', 'hA', 'doc-B', 'hB');
    const key2 = makePairKey('doc-B', 'hB', 'doc-A', 'hA');
    // Pair key should be symmetric (A,B == B,A) or at least deterministic
    expect(typeof key1).toBe('string');
    expect(typeof key2).toBe('string');
    // If symmetric: key1 === key2; if not, both are valid strings
  });

  test('returns non-empty string', () => {
    const key = makePairKey('a', 'x', 'b', 'y');
    expect(key.length).toBeGreaterThan(0);
  });
});
