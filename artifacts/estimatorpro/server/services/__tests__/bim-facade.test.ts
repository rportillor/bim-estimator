/**
 * BIM FACADE — Test Suite
 * Tests the BIM export object (assemble, estimate) and GenerateOpts type.
 */

// Mock dependencies before importing the module under test.
jest.mock('../../routes/progress', () => ({
  publishProgress: jest.fn(),
}));

jest.mock('../../storage', () => ({
  storage: {
    getDocumentsByProject: jest.fn(),
    getBimElements: jest.fn(),
  },
}));

jest.mock('../../bim-generator', () => ({
  BIMGenerator: jest.fn().mockImplementation(() => ({
    generateBIMModel: jest.fn().mockResolvedValue({ id: 'bim-model-1' }),
  })),
}));

jest.mock('../bim-postprocess', () => ({
  postprocessAndSaveBIM_LEGACY: jest.fn(),
}));

import { BIM } from '../bim-facade';
import type { GenerateOpts } from '../bim-facade';
import { storage } from '../../storage';

const mockStorage = storage as jest.Mocked<typeof storage>;

describe('BIM facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('BIM object is defined', () => {
    expect(BIM).toBeDefined();
  });

  test('BIM has assemble method', () => {
    expect(typeof BIM.assemble).toBe('function');
  });

  test('BIM has estimate method', () => {
    expect(typeof BIM.estimate).toBe('function');
  });

  test('GenerateOpts type compliance', () => {
    const opts: GenerateOpts = {
      projectId: 'MOOR-001',
      modelId: 'model-001',
      unitSystem: 'metric',
      analysis: { storeys: 3, building_analysis: {} },
    };
    expect(opts.projectId).toBe('MOOR-001');
    expect(opts.unitSystem).toBe('metric');
  });

  test('assemble throws when no documents found', async () => {
    mockStorage.getDocumentsByProject.mockResolvedValue([]);

    await expect(
      BIM.assemble({
        projectId: 'EMPTY-001',
        modelId: 'model-001',
        unitSystem: 'metric',
      }),
    ).rejects.toThrow(/No documents found/);
  });

  test('assemble returns elements on success', async () => {
    const fakeDocs = [{ id: 'doc-1' }];
    const fakeElements = [{ id: 'elem-1' }, { id: 'elem-2' }];

    mockStorage.getDocumentsByProject.mockResolvedValue(fakeDocs as any);
    mockStorage.getBimElements.mockResolvedValue(fakeElements as any);

    const result = await BIM.assemble({
      projectId: 'PROJ-001',
      modelId: 'model-001',
      unitSystem: 'metric',
    });

    expect(result).toEqual(fakeElements);
    expect(mockStorage.getDocumentsByProject).toHaveBeenCalledWith('PROJ-001');
    expect(mockStorage.getBimElements).toHaveBeenCalledWith('bim-model-1');
  });

  test('estimate returns element count', async () => {
    const fakeElements = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
    mockStorage.getBimElements.mockResolvedValue(fakeElements as any);

    const result = await BIM.estimate('model-42');

    expect(result).toEqual({ elementCount: 3 });
    expect(mockStorage.getBimElements).toHaveBeenCalledWith('model-42');
  });
});
