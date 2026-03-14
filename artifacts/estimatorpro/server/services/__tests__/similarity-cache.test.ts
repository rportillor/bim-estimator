/**
 * ==============================================================================
 *  SIMILARITY CACHE — Test Suite
 * ==============================================================================
 */

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { readSimilarityCache, writeSimilarityCache } from "../similarity-cache";
import type { SimilarityCachePayload } from "../similarity-cache";
import fs from "fs/promises";

const mockFs = fs as jest.Mocked<typeof fs>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("similarity-cache.ts", () => {
  test("readSimilarityCache function exists", () => {
    expect(typeof readSimilarityCache).toBe("function");
  });

  test("writeSimilarityCache function exists", () => {
    expect(typeof writeSimilarityCache).toBe("function");
  });

  test("readSimilarityCache returns null when file does not exist", async () => {
    mockFs.readFile.mockRejectedValue(new Error("ENOENT"));
    const result = await readSimilarityCache("nonexistent");
    expect(result).toBeNull();
  });

  test("readSimilarityCache returns parsed payload when file exists", async () => {
    const payload: SimilarityCachePayload = {
      projectId: "MOOR",
      documentMetadata: {},
      similarities: [{ idA: "a", idB: "b", score: 0.8 }],
      analyzedAt: new Date().toISOString(),
    };
    mockFs.readFile.mockResolvedValue(Buffer.from(JSON.stringify(payload)));
    const result = await readSimilarityCache("MOOR");
    expect(result).toEqual(payload);
    expect(result!.projectId).toBe("MOOR");
  });

  test("writeSimilarityCache writes payload to file", async () => {
    const payload: SimilarityCachePayload = {
      projectId: "MOOR",
      documentMetadata: { docs: 3 },
      similarities: [],
      analyzedAt: new Date().toISOString(),
    };
    await writeSimilarityCache("MOOR", payload);
    expect(mockFs.mkdir).toHaveBeenCalled();
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("MOOR.json"),
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  });

  test("SimilarityCachePayload type compliance", () => {
    const payload: SimilarityCachePayload = {
      projectId: "MOOR",
      documentMetadata: {},
      similarities: [],
      analyzedAt: new Date().toISOString(),
    };
    expect(payload.projectId).toBe("MOOR");
    expect(payload.analyzedAt).toBeDefined();
  });

  test("SimilarityCachePayload supports optional fields", () => {
    const payload: SimilarityCachePayload = {
      projectId: "TEST",
      documentMetadata: {},
      similarities: [],
      overallScore: 0.65,
      riskAreas: ["section-a"],
      analyzedAt: new Date().toISOString(),
    };
    expect(payload.overallScore).toBe(0.65);
    expect(payload.riskAreas).toEqual(["section-a"]);
  });
});
