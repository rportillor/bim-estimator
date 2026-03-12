/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PDF EXTRACT — Test Suite
 *  Tests: StoredDoc type, function existence
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { extractPdfTextAndPages } from '../pdf-extract';
import type { StoredDoc } from '../pdf-extract';

describe('pdf-extract.ts', () => {
  test('extractPdfTextAndPages function exists', () => {
    expect(typeof extractPdfTextAndPages).toBe('function');
  });

  test('StoredDoc type compliance', () => {
    const doc: StoredDoc = {
      id: 'doc-001',
      name: 'A-101.pdf',
      storageKey: 'uploads/A-101.pdf',
    };
    expect(doc.id).toBe('doc-001');
    expect(doc.name).toBe('A-101.pdf');
  });

  test('StoredDoc with null storageKey is valid', () => {
    const doc: StoredDoc = {
      id: 'doc-002',
      name: 'spec.pdf',
      storageKey: null,
    };
    expect(doc.storageKey).toBeNull();
  });
});
