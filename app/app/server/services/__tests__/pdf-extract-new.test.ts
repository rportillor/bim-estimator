/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PDF EXTRACT NEW — Test Suite
 *  Tests: extractPdfTextAndPages, gatherContentForClaude
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { extractPdfTextAndPages, gatherContentForClaude } from '../pdf-extract-new';
import type { StoredDoc } from '../pdf-extract-new';

describe('pdf-extract-new.ts', () => {
  test('extractPdfTextAndPages function exists', () => {
    expect(typeof extractPdfTextAndPages).toBe('function');
  });

  test('gatherContentForClaude function exists', () => {
    expect(typeof gatherContentForClaude).toBe('function');
  });

  test('StoredDoc type compliance', () => {
    const doc: StoredDoc = {
      id: 'doc-003',
      name: 'S-201.pdf',
      storageKey: 'uploads/S-201.pdf',
    };
    expect(doc.id).toBe('doc-003');
  });
});
