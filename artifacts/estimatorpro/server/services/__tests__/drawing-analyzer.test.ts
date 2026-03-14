/**
 * Drawing Analyzer - Test Suite
 */

// Mock storage before importing the module under test
jest.mock('../../storage', () => ({
  storage: {
    getDocument: jest.fn(),
  },
}));

jest.mock('../pdf-extract-new', () => ({
  extractPdfTextAndPages: jest.fn(),
}));

import { analyzeDrawingsForFacts } from '../drawing-analyzer';
import { storage } from '../../storage';
import { extractPdfTextAndPages } from '../pdf-extract-new';

const mockGetDocument = storage.getDocument as jest.Mock;
const mockExtractPdf = extractPdfTextAndPages as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ENABLE_DRAWING_ANALYZER = 'on';
});

describe('analyzeDrawingsForFacts', () => {
  test('is a function', () => {
    expect(typeof analyzeDrawingsForFacts).toBe('function');
  });

  test('returns disabled result when env flag is off', async () => {
    process.env.ENABLE_DRAWING_ANALYZER = 'off';
    const result = await analyzeDrawingsForFacts('proj1', []);
    expect(result).toEqual({ enabled: false, facts: {} });
  });

  test('returns enabled with empty facts for empty docs array', async () => {
    const result = await analyzeDrawingsForFacts('proj1', []);
    expect(result.enabled).toBe(true);
    expect(result.facts).toBeDefined();
    expect(result.facts.panels).toEqual([]);
    expect(result.facts.legendHits).toEqual([]);
  });

  test('skips non-pdf documents', async () => {
    const docs = [{ id: '1', filename: 'notes.txt', fileType: 'text/plain' }];
    const result = await analyzeDrawingsForFacts('proj1', docs);
    expect(mockGetDocument).not.toHaveBeenCalled();
    expect(result.enabled).toBe(true);
  });

  test('processes a pdf document and extracts panel info from electrical sheet', async () => {
    mockGetDocument.mockResolvedValue({ id: '1', storageKey: 'key1' });
    mockExtractPdf.mockResolvedValue({
      pageTexts: ['ELECTRICAL PANEL LP1 200A\nCIRCUIT 1\nCIRCUIT 2'],
      fullText: 'ELECTRICAL PANEL LP1 200A\nCIRCUIT 1\nCIRCUIT 2',
    });

    const docs = [{ id: '1', filename: 'E-101 Electrical Plan.pdf', fileType: 'application/pdf' }];
    const result = await analyzeDrawingsForFacts('proj1', docs);

    expect(result.enabled).toBe(true);
    expect(result.facts.panels.length).toBeGreaterThan(0);
    expect(result.facts.panels[0].tag).toBe('LP1');
    expect(result.facts.panels[0].amps).toBe(200);
    expect(result.facts.panels[0].circuits).toBe(2);
  });

  test('collects legend hits from page text', async () => {
    mockGetDocument.mockResolvedValue({ id: '2', storageKey: 'key2' });
    mockExtractPdf.mockResolvedValue({
      pageTexts: ['sprinkler head pendant type\nlight fixture troffer'],
      fullText: 'sprinkler head pendant type\nlight fixture troffer',
    });

    const docs = [{ id: '2', filename: 'FP-100.pdf', fileType: 'application/pdf' }];
    const result = await analyzeDrawingsForFacts('proj1', docs);

    expect(result.facts.legendHits.length).toBeGreaterThan(0);
    const types = result.facts.legendHits.map((h: any) => h.type);
    expect(types).toContain('SPRINKLER');
    expect(types).toContain('LIGHT_FIXTURE');
  });

  test('continues gracefully when pdf extraction throws', async () => {
    mockGetDocument.mockResolvedValue({ id: '3', storageKey: 'key3' });
    mockExtractPdf.mockRejectedValue(new Error('corrupt pdf'));

    const docs = [{ id: '3', filename: 'bad.pdf', fileType: 'application/pdf' }];
    const result = await analyzeDrawingsForFacts('proj1', docs);

    expect(result.enabled).toBe(true);
    expect(result.facts.panels).toEqual([]);
  });
});
