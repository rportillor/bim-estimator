/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FILE STORAGE — Test Suite
 *  Tests: class instantiation, interface compliance
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { FileStorageService } from '../file-storage';
import type { FileStorageResult } from '../file-storage';

describe('FileStorageService', () => {
  test('class can be instantiated', () => {
    const service = new FileStorageService();
    expect(service).toBeInstanceOf(FileStorageService);
  });

  test('has storeFile method', () => {
    const service = new FileStorageService();
    expect(typeof service.storeFile).toBe('function');
  });

  test('has getFile method', () => {
    const service = new FileStorageService();
    expect(typeof service.getFile).toBe('function');
  });

  test('FileStorageResult interface compliance', () => {
    const result: FileStorageResult = {
      key: 'uploads/project-001/A-101.pdf',
      size: 1024000,
      mimeType: 'application/pdf',
    };
    expect(result.key).toContain('A-101');
    expect(result.size).toBeGreaterThan(0);
  });
});
