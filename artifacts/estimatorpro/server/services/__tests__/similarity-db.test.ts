/**
 * ==============================================================================
 *  SIMILARITY DB — Test Suite
 *  Tests: hashText, makePairKey (pure functions), plus DB-dependent functions
 * ==============================================================================
 */

const mockSelect = jest.fn();
const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockInsert = jest.fn();
const mockValues = jest.fn();
const mockOnConflict = jest.fn();
const mockReturning = jest.fn();

jest.mock("../../db", () => ({
  db: {
    select: (...args: any[]) => {
      mockSelect(...args);
      return { from: (...a: any[]) => { mockFrom(...a); return { where: (...w: any[]) => { mockWhere(...w); return { limit: (...l: any[]) => { mockLimit(...l); return Promise.resolve([]); } }; } }; } };
    },
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: (...v: any[]) => { mockValues(...v); return { onConflictDoUpdate: (...c: any[]) => { mockOnConflict(...c); return { returning: (...r: any[]) => { mockReturning(...r); return Promise.resolve([{ id: 1 }]); } }; } }; } };
    },
  },
}));

jest.mock("@shared/schema", () => ({
  documentSimilarityCache: {
    id: "id",
    documentPairHash: "document_pair_hash",
    documentAId: "document_a_id",
    documentBId: "document_b_id",
    documentAContentHash: "document_a_content_hash",
    documentBContentHash: "document_b_content_hash",
    analysisResult: "analysis_result",
    similarityScore: "similarity_score",
    overlapType: "overlap_type",
    details: "details",
    conflicts: "conflicts",
    recommendations: "recommendations",
    criticalLevel: "critical_level",
    usageCount: "usage_count",
    lastUsed: "last_used",
    claudeTokensUsed: "claude_tokens_used",
    claudeModel: "claude_model",
    analysisVersion: "analysis_version",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

import { hashText, makePairKey, getCachedPairByTexts, getCachedPairByKey } from "../similarity-db";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hashText", () => {
  test("returns consistent hash for same input", () => {
    const h1 = hashText("Hello World");
    const h2 = hashText("Hello World");
    expect(h1).toBe(h2);
  });

  test("different inputs produce different hashes", () => {
    const h1 = hashText("Hello");
    const h2 = hashText("World");
    expect(h1).not.toBe(h2);
  });

  test("returns non-empty string", () => {
    const hash = hashText("test");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("empty string produces valid hash", () => {
    const hash = hashText("");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("long string produces hash", () => {
    const longString = "A".repeat(100000);
    const hash = hashText(longString);
    expect(hash.length).toBeGreaterThan(0);
  });

  test("normalizes whitespace and case", () => {
    const h1 = hashText("Hello  World");
    const h2 = hashText("hello world");
    expect(h1).toBe(h2);
  });
});

describe("makePairKey", () => {
  test("creates deterministic key from two IDs + hashes", () => {
    const key1 = makePairKey("doc-A", "hashA", "doc-B", "hashB");
    const key2 = makePairKey("doc-A", "hashA", "doc-B", "hashB");
    expect(key1).toBe(key2);
  });

  test("symmetric: order of pairs does not matter", () => {
    const key1 = makePairKey("doc-A", "hA", "doc-B", "hB");
    const key2 = makePairKey("doc-B", "hB", "doc-A", "hA");
    expect(key1).toBe(key2);
  });

  test("returns non-empty string", () => {
    const key = makePairKey("a", "x", "b", "y");
    expect(key.length).toBeGreaterThan(0);
  });

  test("different pairs produce different keys", () => {
    const key1 = makePairKey("a", "x", "b", "y");
    const key2 = makePairKey("a", "x", "c", "z");
    expect(key1).not.toBe(key2);
  });
});

describe("getCachedPairByTexts", () => {
  test("is a function", () => {
    expect(typeof getCachedPairByTexts).toBe("function");
  });

  test("returns null when no rows found", async () => {
    const result = await getCachedPairByTexts("a", "textA", "b", "textB");
    expect(result).toBeNull();
  });
});

describe("getCachedPairByKey", () => {
  test("is a function", () => {
    expect(typeof getCachedPairByKey).toBe("function");
  });

  test("returns null when no rows found", async () => {
    const result = await getCachedPairByKey("somehash");
    expect(result).toBeNull();
  });
});
