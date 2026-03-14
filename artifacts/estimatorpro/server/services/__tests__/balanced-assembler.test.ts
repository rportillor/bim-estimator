/**
 * BALANCED ASSEMBLER — Test Suite
 * Tests: balancedAssemble function
 */

// Mock helper dependencies before importing the module under test
jest.mock('../../helpers/structural-seed', () => ({
  seedStructuralFromAnalysis: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../helpers/lod-expander', () => ({
  expandWithLod: jest.fn((els: any[]) => els),
}));

jest.mock('../../helpers/lod-profile', () => ({
  getLodProfile: jest.fn(() => ({})),
}));

jest.mock('../../helpers/storey-inference', () => ({
  inferStoreysIfMissing: jest.fn((incoming: any[]) => incoming ?? []),
}));

jest.mock('../../helpers/family', () => ({
  countByFamily: jest.fn(() => ({ STRUCT: 100, ARCH: 50, MEP: 10, OTHER: 5, BASE: 150 })),
}));

import { balancedAssemble } from '../balanced-assembler';
import { seedStructuralFromAnalysis } from '../../helpers/structural-seed';
import { inferStoreysIfMissing } from '../../helpers/storey-inference';
import { countByFamily } from '../../helpers/family';

describe('balancedAssemble', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('is an exported async function', () => {
    expect(typeof balancedAssemble).toBe('function');
  });

  test('returns { elements } for an empty baseElements array', async () => {
    const result = await balancedAssemble({
      baseElements: [],
      storeys: [],
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('elements');
    expect(Array.isArray(result.elements)).toBe(true);
  });

  test('passes incoming storeys through inferStoreysIfMissing', async () => {
    const storeys = [{ name: 'Ground Floor', elevation: 0 }, { name: 'Level 1', elevation: 3.5 }];

    await balancedAssemble({
      baseElements: [],
      storeys,
    });

    expect(inferStoreysIfMissing).toHaveBeenCalledTimes(1);
    // First arg should be the mapped storeys array, second arg the elements array
    const call = (inferStoreysIfMissing as jest.Mock).mock.calls[0];
    expect(Array.isArray(call[0])).toBe(true);
    expect(Array.isArray(call[1])).toBe(true);
  });

  test('returns the same elements when BASE count is above threshold', async () => {
    const elements = [
      { elementType: 'WALL', geometry: { location: { realLocation: { x: 0, y: 0, z: 0 } } } },
      { elementType: 'BEAM', geometry: { location: { realLocation: { x: 1, y: 0, z: 0 } } } },
    ];

    const result = await balancedAssemble({
      baseElements: elements,
      storeys: [],
    });

    // countByFamily mock returns BASE=150, so seeding should NOT be triggered
    expect(seedStructuralFromAnalysis).not.toHaveBeenCalled();
    expect(result.elements.length).toBe(elements.length);
  });

  test('triggers seeding when BASE count is too small', async () => {
    (countByFamily as jest.Mock).mockReturnValue({ STRUCT: 1, ARCH: 0, MEP: 0, OTHER: 0, BASE: 1 });

    const seededElement = { elementType: 'WALL', geometry: {} };
    (seedStructuralFromAnalysis as jest.Mock).mockResolvedValue([seededElement]);

    // After seeding, countByFamily will be called again — return healthy counts
    (countByFamily as jest.Mock)
      .mockReturnValueOnce({ STRUCT: 1, ARCH: 0, MEP: 0, OTHER: 0, BASE: 1 })
      .mockReturnValueOnce({ STRUCT: 50, ARCH: 50, MEP: 0, OTHER: 0, BASE: 100 });

    const result = await balancedAssemble({
      baseElements: [{ elementType: 'DOOR', geometry: {} }],
      analysis: { buildingType: 'office' },
      storeys: [],
    });

    expect(seedStructuralFromAnalysis).toHaveBeenCalledTimes(1);
    // Seeded element should be prepended to the output
    expect(result.elements.length).toBeGreaterThanOrEqual(2);
  });

  test('assigns storey elevations to elements when storeys are provided', async () => {
    const storeys = [{ name: 'Ground Floor', elevation: 0 }];

    (inferStoreysIfMissing as jest.Mock).mockReturnValue(
      storeys.map(s => ({ name: s.name, elevation: s.elevation }))
    );

    const element = {
      elementType: 'WALL',
      storey: { name: 'Ground Floor' },
      geometry: { location: { realLocation: { x: 0, y: 0, z: 1 } } },
    };

    const result = await balancedAssemble({
      baseElements: [element],
      storeys,
    });

    const out = result.elements[0];
    console.log('OUT', JSON.stringify(out, null, 2));
    expect(out.storey).toBeDefined();
    expect(out.storey.name).toBe('Ground Floor');
    expect(out.storey.elevation).toBe(0);
  });
});
