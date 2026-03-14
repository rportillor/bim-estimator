/**
 * ==============================================================================
 *  SIMILARITY SUMMARY — Test Suite
 * ==============================================================================
 */

const mockSelectFrom = jest.fn();
const mockSelectWhere = jest.fn();

jest.mock("../../db", () => ({
  db: {
    select: jest.fn(() => ({
      from: (...args: any[]) => {
        mockSelectFrom(...args);
        return {
          where: (...w: any[]) => {
            mockSelectWhere(...w);
            return Promise.resolve([]);
          },
        };
      },
    })),
  },
}));

jest.mock("@shared/schema", () => ({
  documentSimilarityCache: {
    id: "id",
    documentAId: "document_a_id",
    documentBId: "document_b_id",
    similarityScore: "similarity_score",
    criticalLevel: "critical_level",
  },
}));

jest.mock("../../storage", () => ({
  storage: {
    getDocumentsByProject: jest.fn().mockResolvedValue([]),
  },
}));

import { buildProjectSimilaritySummary } from "../similarity-summary";
import type { ProjectSimilaritySummary } from "../similarity-summary";
import { storage } from "../../storage";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("similarity-summary.ts", () => {
  test("buildProjectSimilaritySummary function exists", () => {
    expect(typeof buildProjectSimilaritySummary).toBe("function");
  });

  test("returns empty summary when no documents exist", async () => {
    const result = await buildProjectSimilaritySummary("test-project");
    expect(result.projectId).toBe("test-project");
    expect(result.documents).toEqual([]);
    expect(result.pairs).toEqual([]);
    expect(result.overallScore).toBe(0);
    expect(result.counts.totalPairs).toBe(0);
  });

  test("calls storage.getDocumentsByProject", async () => {
    await buildProjectSimilaritySummary("test-project");
    expect(storage.getDocumentsByProject).toHaveBeenCalledWith("test-project");
  });

  test("returns promise", () => {
    const result = buildProjectSimilaritySummary("test-project");
    expect(result).toBeInstanceOf(Promise);
  });

  test("ProjectSimilaritySummary type compliance", () => {
    const summary: ProjectSimilaritySummary = {
      projectId: "MOOR",
      documents: [{ id: "d1", filename: "file.pdf" }],
      pairs: [{ a: "d1", b: "d2", score: 0.75, criticalLevel: "medium" }],
      overallScore: 0.75,
      counts: { totalPairs: 1, critical: 0, high: 0, medium: 1, low: 0 },
      analyzedAt: new Date().toISOString(),
    };
    expect(summary.overallScore).toBeCloseTo(0.75);
    expect(summary.counts.medium).toBe(1);
  });

  test("returns documents when project has docs", async () => {
    (storage.getDocumentsByProject as jest.Mock).mockResolvedValueOnce([
      { id: "d1", filename: "a.pdf" },
      { id: "d2", filename: "b.pdf" },
    ]);
    const result = await buildProjectSimilaritySummary("proj");
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].id).toBe("d1");
  });
});
