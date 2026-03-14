/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RASTER LEGEND ASSOC — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock storage before importing the module under test
jest.mock('../../storage', () => ({
  storage: {
    getDocumentsByProject: jest.fn(),
    getDocument: jest.fn(),
  },
}));

// Mock sharp — optional native dependency
jest.mock('sharp', () => {
  const instance = {
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }),
    removeAlpha: jest.fn().mockReturnThis(),
    grayscale: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(100 * 100)),
  };
  return jest.fn(() => instance);
});

import { detectRoundSymbolsFromRasters } from '../raster-legend-assoc';
import { storage } from '../../storage';

const mockGetDocsByProject = storage.getDocumentsByProject as jest.Mock;
const mockGetDocument = storage.getDocument as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('raster-legend-assoc.ts', () => {
  test('detectRoundSymbolsFromRasters function exists', () => {
    expect(typeof detectRoundSymbolsFromRasters).toBe('function');
  });

  test('returns empty array when no documents found', async () => {
    mockGetDocsByProject.mockResolvedValue([]);
    const result = await detectRoundSymbolsFromRasters('proj-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when no documents match plan pattern', async () => {
    mockGetDocsByProject.mockResolvedValue([
      { id: 'doc-1', fileType: 'application/pdf', filename: 'schedule.pdf' },
    ]);
    const result = await detectRoundSymbolsFromRasters('proj-1');
    expect(result).toEqual([]);
  });

  test('skips documents without raster previews', async () => {
    mockGetDocsByProject.mockResolvedValue([
      { id: 'doc-1', fileType: 'application/pdf', filename: 'site plan.pdf' },
    ]);
    mockGetDocument.mockResolvedValue({ id: 'doc-1', rasterPreviews: [] });
    const result = await detectRoundSymbolsFromRasters('proj-1');
    expect(result).toEqual([]);
  });

  test('returns a promise', () => {
    mockGetDocsByProject.mockResolvedValue([]);
    const result = detectRoundSymbolsFromRasters('test-project');
    expect(result).toBeInstanceOf(Promise);
  });

  test('accepts maxPages parameter', () => {
    mockGetDocsByProject.mockResolvedValue([]);
    const result = detectRoundSymbolsFromRasters('test-project', 3);
    expect(result).toBeInstanceOf(Promise);
  });
});
