/**
 * BIM POSTPROCESS — Test Suite
 *
 * Mocks every storage / helper dependency so the module can be imported
 * without touching real DB or filesystem code.
 */

// ── Mock heavy dependencies BEFORE any import of the module under test ──

jest.mock("../../storage", () => ({
  storage: {
    upsertBimElements: jest.fn().mockResolvedValue(undefined),
    updateBimModelMetadata: jest.fn().mockResolvedValue(undefined),
    getBimModel: jest.fn().mockResolvedValue({ metadata: {} }),
    createBimElement: jest.fn().mockResolvedValue(undefined),
    saveBimElements: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../helpers/layout-repair", () => ({
  repairLayout: jest.fn((_elems: any[]) => ({
    elements: _elems || [],
    footprint: [],
    propertyLine: [],
    grid: { xs: [], ys: [] },
    applied: false,
    reason: "none",
    stats: {},
  })),
}));

jest.mock("../../helpers/grid-detect", () => ({
  detectGridFromElements: jest.fn(() => ({ xs: [], ys: [] })),
}));

jest.mock("../../services/footprint-extractor", () => ({
  ensureFootprintForModel: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../helpers/layout-calibration", () => ({
  calibrateAndPositionElements: jest.fn(async (_pid: string, _mid: string, elems: any[]) => elems),
}));

jest.mock("../../helpers/site-utils", () => ({
  applySiteContext: jest.fn((elems: any[]) => elems),
}));

jest.mock("../../helpers/element-sanitizer", () => ({
  sanitizeElements: jest.fn((elems: any[]) => ({
    elements: elems,
    report: { fixedCount: 0, swaps: 0, clamped: 0, zeros: 0 },
  })),
}));

jest.mock("../../services/raster-legend-assoc", () => ({
  detectRoundSymbolsFromRasters: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../helpers/site-symbols", () => ({
  placeDetectedSymbolsAsElements: jest.fn(() => []),
  placeDetectedSymbolsAsElements_LEGACY: jest.fn(() => []),
}));

jest.mock("../../services/raster-glyph-locator", () => ({
  detectRasterSymbolsForModel: jest.fn().mockResolvedValue([]),
}));

jest.mock("../../services/moorings-project-data", () => ({
  FLOOR_DATUMS: [
    { level: "GF", label: "Ground Floor", elevationM: 262.25, ftfHeightM: 4.0, source: "test", confidence: "C1" },
  ],
}));

// ── Now import the module under test ──

import {
  postprocessAndSave,
  postprocessAndSaveBIM,
  postprocessAndSaveBIM_LEGACY,
} from "../bim-postprocess";

import { storage } from "../../storage";

// ── Helpers ──

function makeElement(overrides: Record<string, any> = {}) {
  return {
    id: "el-1",
    type: "wall",
    category: "WALL",
    name: "Test Wall",
    geometry: { location: { realLocation: { x: 1, y: 2, z: 0 } } },
    properties: {},
    ...overrides,
  };
}

// ── Tests ──

describe("bim-postprocess exports", () => {
  test("postprocessAndSave is an async function", () => {
    expect(typeof postprocessAndSave).toBe("function");
  });

  test("postprocessAndSaveBIM is an async function", () => {
    expect(typeof postprocessAndSaveBIM).toBe("function");
  });

  test("postprocessAndSaveBIM_LEGACY is an async function", () => {
    expect(typeof postprocessAndSaveBIM_LEGACY).toBe("function");
  });
});

describe("postprocessAndSave", () => {
  beforeEach(() => jest.clearAllMocks());

  test("calls storage.upsertBimElements with the model ID", async () => {
    const elems = [makeElement()];
    await postprocessAndSave("model-1", elems, {});

    expect(storage.upsertBimElements).toHaveBeenCalledTimes(1);
    expect((storage.upsertBimElements as jest.Mock).mock.calls[0][0]).toBe("model-1");
  });

  test("assigns renderFamily / renderColor properties to elements", async () => {
    const elems = [makeElement({ category: "WALL" })];
    await postprocessAndSave("model-2", elems, {});

    const savedElems = (storage.upsertBimElements as jest.Mock).mock.calls[0][1] as any[];
    expect(savedElems[0].properties.renderFamily).toBe("STRUCT");
    expect(savedElems[0].properties.renderColor).toBe("#6B7280");
  });

  test("handles empty element array gracefully", async () => {
    await postprocessAndSave("model-3", [], {});
    expect(storage.upsertBimElements).toHaveBeenCalledWith("model-3", []);
  });
});

describe("postprocessAndSaveBIM", () => {
  beforeEach(() => jest.clearAllMocks());

  test("fast path: routes to postprocessAndSave when no calibration opts", async () => {
    const elems = [makeElement()];
    await postprocessAndSaveBIM({
      modelId: "m-1",
      projectId: "p-1",
      elements: elems,
    });

    // Fast path uses upsertBimElements via postprocessAndSave
    expect(storage.upsertBimElements).toHaveBeenCalled();
  });

  test("legacy path: routes to LEGACY when forceCalibrate is true", async () => {
    const elems = [makeElement()];
    const result = await postprocessAndSaveBIM({
      modelId: "m-2",
      projectId: "p-2",
      elements: elems,
      forceCalibrate: true,
    });

    // LEGACY pipeline returns an object with { saved, summary, siteUsed }
    expect(result).toHaveProperty("saved");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("siteUsed");
  });

  test("legacy path: routes to LEGACY when anthropic client provided", async () => {
    const result = await postprocessAndSaveBIM({
      modelId: "m-3",
      projectId: "p-3",
      elements: [makeElement()],
      anthropic: {},
    });

    expect(result).toHaveProperty("saved", 1);
  });
});

describe("postprocessAndSaveBIM_LEGACY", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns saved count and summary", async () => {
    const result = await postprocessAndSaveBIM_LEGACY({
      modelId: "m-4",
      projectId: "p-4",
      elements: [makeElement(), makeElement({ id: "el-2" })],
    });

    expect(result.saved).toBe(2);
    expect(result.summary).toBeDefined();
    expect(typeof result.siteUsed).toBe("boolean");
  });

  test("persists elements via storage", async () => {
    await postprocessAndSaveBIM_LEGACY({
      modelId: "m-5",
      projectId: "p-5",
      elements: [makeElement()],
    });

    expect(storage.upsertBimElements).toHaveBeenCalledWith("m-5", expect.any(Array));
  });

  test("survives with zero elements", async () => {
    const result = await postprocessAndSaveBIM_LEGACY({
      modelId: "m-6",
      projectId: "p-6",
      elements: [],
    });

    expect(result.saved).toBe(0);
  });
});
