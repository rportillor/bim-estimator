/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MODEL STATUS — Test Suite
 *  Tests: coerceStatus helper, updateModelStatus mock
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { coerceStatus, updateModelStatus } from '../model-status';

describe('coerceStatus', () => {
  test('returns valid status unchanged', () => {
    expect(coerceStatus('queued')).toBe('queued');
    expect(coerceStatus('generating')).toBe('generating');
    expect(coerceStatus('postprocessing')).toBe('postprocessing');
    expect(coerceStatus('completed')).toBe('completed');
    expect(coerceStatus('failed')).toBe('failed');
  });

  test('returns default for invalid status', () => {
    const result = coerceStatus('invalid_status');
    expect(['queued', 'failed']).toContain(result);
  });

  test('handles null input', () => {
    const result = coerceStatus(null);
    expect(result).toBeDefined();
  });

  test('handles undefined input', () => {
    const result = coerceStatus(undefined);
    expect(result).toBeDefined();
  });

  test('handles numeric input', () => {
    const result = coerceStatus(42);
    expect(typeof result).toBe('string');
  });
});

describe('updateModelStatus', () => {
  test('function exists', () => {
    expect(typeof updateModelStatus).toBe('function');
  });

  test('calls storage method when available', async () => {
    const mockStorage = {
      updateBimModelStatus: jest.fn().mockResolvedValue(true),
    };
    await updateModelStatus(mockStorage, 'model-001', { status: 'completed', progress: 1.0 });
    expect(mockStorage.updateBimModelStatus).toHaveBeenCalledWith('model-001', expect.objectContaining({ status: 'completed' }));
  });

  test('handles missing storage gracefully', async () => {
    // Should not throw when storage is null/undefined
    await expect(updateModelStatus(null, 'model-001', { status: 'failed' })).resolves.not.toThrow();
  });

  test('handles storage without updateBimModelStatus', async () => {
    const emptyStorage = {};
    await expect(updateModelStatus(emptyStorage, 'model-001', { status: 'generating' })).resolves.not.toThrow();
  });
});
