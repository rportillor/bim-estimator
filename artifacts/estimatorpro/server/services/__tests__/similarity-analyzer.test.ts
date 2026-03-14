/**
 * ==============================================================================
 *  SIMILARITY ANALYZER — Test Suite
 * ==============================================================================
 */

jest.mock("../../document-similarity", () => ({
  runDocumentSimilarity: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/similarity-cache", () => ({
  readSimilarityCache: jest.fn().mockResolvedValue({
    similarities: [
      { idA: "a", idB: "b", score: 0.9 },
      { idA: "c", idB: "d", score: 0.5 },
    ],
  }),
}));

import { similarityAnalyzer } from "../similarity-analyzer";
import { runDocumentSimilarity } from "../../document-similarity";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("similarity-analyzer.ts", () => {
  test("singleton exists", () => {
    expect(similarityAnalyzer).toBeDefined();
  });

  test("has start method", () => {
    expect(typeof similarityAnalyzer.start).toBe("function");
  });

  test("has analyzeProjectDocuments method", () => {
    expect(typeof similarityAnalyzer.analyzeProjectDocuments).toBe("function");
  });

  test("has getProgress method", () => {
    expect(typeof similarityAnalyzer.getProgress).toBe("function");
  });

  test("has hasActiveSession method", () => {
    expect(typeof similarityAnalyzer.hasActiveSession).toBe("function");
  });

  test("has generateHeatmapData method", () => {
    expect(typeof similarityAnalyzer.generateHeatmapData).toBe("function");
  });

  test("has detectComplianceOverlaps method", () => {
    expect(typeof similarityAnalyzer.detectComplianceOverlaps).toBe("function");
  });

  test("getProgress returns idle status initially", () => {
    const p = similarityAnalyzer.getProgress();
    expect(p.status).toBe("idle");
    expect(p.totalPairs).toBe(0);
  });

  test("hasActiveSession returns false when idle", () => {
    expect(similarityAnalyzer.hasActiveSession()).toBe(false);
  });

  test("start invokes runDocumentSimilarity", async () => {
    const pairs = [{ a: "1", b: "2" }];
    const meta = {};
    await similarityAnalyzer.start("proj", {}, pairs, meta);
    expect(runDocumentSimilarity).toHaveBeenCalledWith(
      "proj",
      {},
      pairs,
      meta,
      expect.any(Function)
    );
  });

  test("getProgress returns done after successful start", async () => {
    await similarityAnalyzer.start("proj", {}, [{ a: "1", b: "2" }], {});
    const p = similarityAnalyzer.getProgress();
    expect(p.status).toBe("done");
    expect(p.finishedAt).toBeDefined();
  });

  test("generateHeatmapData returns grid data", async () => {
    const result = await similarityAnalyzer.generateHeatmapData("proj");
    expect(result.projectId).toBe("proj");
    expect(result.grid).toBeDefined();
    expect(result.generatedAt).toBeDefined();
  });

  test("detectComplianceOverlaps returns stub result", async () => {
    const result = await similarityAnalyzer.detectComplianceOverlaps("proj");
    expect(result.projectId).toBe("proj");
    expect(result.items).toEqual([]);
  });
});
