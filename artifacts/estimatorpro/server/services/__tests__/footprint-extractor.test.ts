/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FOOTPRINT EXTRACTOR — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock all external dependencies before importing the module under test
jest.mock('../../storage', () => ({
  storage: {
    getDocumentsByProject: jest.fn().mockResolvedValue([]),
    getDocument: jest.fn().mockResolvedValue(null),
    getBimModel: jest.fn().mockResolvedValue(null),
    updateBimModelMetadata: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/pdf-extract', () => ({
  extractPdfTextAndPages: jest.fn().mockResolvedValue({ pageTexts: [] }),
}));

jest.mock('sharp', () => {
  return jest.fn().mockReturnValue({
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 }),
    resize: jest.fn().mockReturnThis(),
    grayscale: jest.fn().mockReturnThis(),
    normalise: jest.fn().mockReturnThis(),
    toColourspace: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.alloc(0)),
  });
});

jest.mock('../../helpers/geom-utils', () => ({
  convexHull: jest.fn((pts) => pts.slice(0, 4)),
  Pt: undefined,
}));

import { ensureFootprintForModel } from '../footprint-extractor';
import { storage } from '../../storage';
import { extractPdfTextAndPages } from "../pdf-extract";

const mockStorage = storage as any;

describe('footprint-extractor.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ensureFootprintForModel is exported as a function', () => {
    expect(typeof ensureFootprintForModel).toBe('function');
  });

  test('returns a promise', () => {
    const result = ensureFootprintForModel({
      modelId: 'test-model',
      projectId: 'test-project',
    });
    expect(result).toBeInstanceOf(Promise);
    return result; // let jest await it
  });

  test('returns null when no documents, no metadata, and no anthropic client', async () => {
    mockStorage.getDocumentsByProject.mockResolvedValue([]);
    (mockStorage as any).getBimModel.mockResolvedValue(null);

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
    });

    expect(result).toBeNull();
  });

  test('returns metadata-sourced result when BIM model has footprint', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue({
      metadata: {
        analysis: {
          units: 'metric',
          footprint: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      },
    });

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('metadata');
    expect(result!.building_footprint).toBeDefined();
    expect(result!.building_footprint!.length).toBeGreaterThanOrEqual(4);
  });

  test('returns metadata with imperial-to-meter conversion', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue({
      metadata: {
        analysis: {
          units: 'imperial',
          footprint: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
            { x: 0, y: 0 },
          ],
        },
      },
    });

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('metadata');
    // 100 ft * 0.3048 = 30.48 m
    expect(result!.building_footprint![1].x).toBeCloseTo(30.48, 2);
  });

  test('queries storage for project documents when no metadata', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue(null);
    mockStorage.getDocumentsByProject.mockResolvedValue([]);

    await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
    });

    expect(mockStorage.getDocumentsByProject).toHaveBeenCalledWith('project-1');
  });

  test('prioritizes site-plan-named PDFs', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue(null);
    mockStorage.getDocumentsByProject.mockResolvedValue([
      { id: 'd1', filename: 'elevations.pdf', fileType: 'application/pdf' },
      { id: 'd2', filename: 'A02-SITE_PLAN.pdf', fileType: 'application/pdf' },
      { id: 'd3', filename: 'schedule.pdf', fileType: 'application/pdf' },
    ] as any);
    mockStorage.getDocument.mockResolvedValue({ storageKey: 'key', rasterPreviews: '[]' } as any);
    (extractPdfTextAndPages as jest.Mock).mockResolvedValue({ pageTexts: ['some text'] });

    await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
      maxDocs: 2,
    });

    // The site-plan doc should be fetched first
    const calls = mockStorage.getDocument.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0]).toBe('d2');
  });

  test('calls anthropic client when pages are available', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue(null);
    mockStorage.getDocumentsByProject.mockResolvedValue([
      { id: 'd1', filename: 'site-plan.pdf', fileType: 'application/pdf' },
    ] as any);
    mockStorage.getDocument.mockResolvedValue({ storageKey: 'k', rasterPreviews: '[]' } as any);
    (extractPdfTextAndPages as jest.Mock).mockResolvedValue({
      pageTexts: ['site plan with property line and building footprint'],
    });

    const mockCreate = jest.fn().mockResolvedValue({
      content: [
        {
          text: JSON.stringify({
            units: 'metric',
            property_line: [
              { x: 0, y: 0 }, { x: 50, y: 0 },
              { x: 50, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 0 },
            ],
            building_footprint: [
              { x: 10, y: 10 }, { x: 40, y: 10 },
              { x: 40, y: 30 }, { x: 10, y: 30 }, { x: 10, y: 10 },
            ],
            legend: [],
            legend_line_types: [],
            notes: [],
          }),
        },
      ],
    });

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
      anthropicClient: { messages: { create: mockCreate } },
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('claude-siteplan');
    expect(result!.property_line).toBeDefined();
    expect(result!.building_footprint).toBeDefined();
  });

  test('returns null when anthropic client is missing and no raster/text fallback', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue(null);
    mockStorage.getDocumentsByProject.mockResolvedValue([
      { id: 'd1', filename: 'drawing.pdf', fileType: 'application/pdf' },
    ] as any);
    mockStorage.getDocument.mockResolvedValue({ storageKey: 'k', rasterPreviews: '[]' } as any);
    (extractPdfTextAndPages as jest.Mock).mockResolvedValue({
      pageTexts: ['no dimensions here'],
    });

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
      // no anthropicClient
    });

    expect(result).toBeNull();
  });

  test('text-dims fallback creates rectangle from dimension text', async () => {
    (mockStorage as any).getBimModel.mockResolvedValue(null);
    mockStorage.getDocumentsByProject.mockResolvedValue([
      { id: 'd1', filename: 'notes.pdf', fileType: 'application/pdf' },
    ] as any);
    mockStorage.getDocument.mockResolvedValue({ storageKey: 'k', rasterPreviews: '[]' } as any);
    (extractPdfTextAndPages as jest.Mock).mockResolvedValue({
      pageTexts: ['Building is 30m wide and 20m long'],
    });

    const result = await ensureFootprintForModel({
      modelId: 'model-1',
      projectId: 'project-1',
      // no anthropicClient
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('text-dims');
    expect(result!.building_footprint).toBeDefined();
    // Should be a closed rectangle
    expect(result!.building_footprint!.length).toBe(5);
    // Width should be 30, length should be 20 (sorted: max first for width)
    expect(result!.building_footprint![2].x).toBe(30);
    expect(result!.building_footprint![2].y).toBe(20);
  });
});
