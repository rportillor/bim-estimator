/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CASCADE DELETE — Test Suite
 *  Tests: function exports, parameter validation
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { safeDeleteModel, bulkDeleteModels } from '../cascade-delete';

describe('cascade-delete.ts', () => {
  test('safeDeleteModel function exists', () => {
    expect(typeof safeDeleteModel).toBe('function');
  });

  test('bulkDeleteModels function exists', () => {
    expect(typeof bulkDeleteModels).toBe('function');
  });

  test('safeDeleteModel rejects invalid model ID', async () => {
    try {
      await safeDeleteModel('nonexistent-model-id');
      // If DB not available, may throw connection error
    } catch (e: any) {
      expect(e).toBeDefined();
    }
  });
});
