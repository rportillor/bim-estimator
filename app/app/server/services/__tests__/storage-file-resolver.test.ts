/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STORAGE FILE RESOLVER — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { loadFileBuffer, deleteModelCascade } from '../storage-file-resolver';

describe('storage-file-resolver.ts', () => {
  test('loadFileBuffer function exists', () => {
    expect(typeof loadFileBuffer).toBe('function');
  });

  test('deleteModelCascade function exists', () => {
    expect(typeof deleteModelCascade).toBe('function');
  });

  test('loadFileBuffer returns a promise', () => {
    const result = loadFileBuffer('fake-storage-key');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('deleteModelCascade returns a promise', () => {
    const result = deleteModelCascade('fake-model-id');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
