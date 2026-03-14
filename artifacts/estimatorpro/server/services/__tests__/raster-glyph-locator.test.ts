/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  RASTER GLYPH LOCATOR — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock storage before importing the module under test
jest.mock('../../storage', () => ({
  storage: {
    getBimModel: jest.fn(),
    getDocumentsByProject: jest.fn(),
    getDocument: jest.fn(),
    getFilePath: jest.fn(),
  },
}));

// Mock fs so we never touch real filesystem
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
}));

import { detectRasterSymbolsForModel } from '../raster-glyph-locator';
import { storage } from '../../storage';

const mockGetBimModel = (storage as any).getBimModel as jest.Mock;
const mockGetDocsByProject = storage.getDocumentsByProject as jest.Mock;
const mockGetDocument = storage.getDocument as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('raster-glyph-locator.ts', () => {
  test('detectRasterSymbolsForModel function exists', () => {
    expect(typeof detectRasterSymbolsForModel).toBe('function');
  });

  test('returns empty array when ENABLE_RASTER_GLYPH is not set', async () => {
    delete process.env.ENABLE_RASTER_GLYPH;
    const result = await detectRasterSymbolsForModel('model-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when ENABLE_RASTER_GLYPH is off', async () => {
    process.env.ENABLE_RASTER_GLYPH = 'off';
    const result = await detectRasterSymbolsForModel('model-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when model has no projectId', async () => {
    process.env.ENABLE_RASTER_GLYPH = 'on';
    mockGetBimModel.mockResolvedValue({ id: 'model-1' });
    const result = await detectRasterSymbolsForModel('model-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when project has no documents', async () => {
    process.env.ENABLE_RASTER_GLYPH = 'on';
    mockGetBimModel.mockResolvedValue({ id: 'model-1', projectId: 'proj-1' });
    mockGetDocsByProject.mockResolvedValue([]);
    const result = await detectRasterSymbolsForModel('model-1');
    expect(result).toEqual([]);
  });

  test('returns empty array when documents have no raster previews', async () => {
    process.env.ENABLE_RASTER_GLYPH = 'on';
    mockGetBimModel.mockResolvedValue({ id: 'model-1', projectId: 'proj-1' });
    mockGetDocsByProject.mockResolvedValue([{ id: 'doc-1' }]);
    mockGetDocument.mockResolvedValue({ id: 'doc-1', rasterPreviews: [] });
    const result = await detectRasterSymbolsForModel('model-1');
    expect(result).toEqual([]);
  });

  test('returns a promise', () => {
    delete process.env.ENABLE_RASTER_GLYPH;
    const result = detectRasterSymbolsForModel('test-model');
    expect(result).toBeInstanceOf(Promise);
  });
});
