/**
 * ==============================================================================
 *  SIMILARITY EVICT — Test Suite
 * ==============================================================================
 */

const mockDeleteWhere = jest.fn();
const mockDeleteReturning = jest.fn();
const mockSelectFrom = jest.fn();
const mockSelectWhere = jest.fn();
const mockSelectOrderBy = jest.fn();
const mockSelectLimit = jest.fn();

jest.mock("../../db", () => ({
  db: {
    delete: jest.fn(() => ({
      where: (...args: any[]) => {
        mockDeleteWhere(...args);
        return {
          returning: (...r: any[]) => {
            mockDeleteReturning(...r);
            return Promise.resolve([]);
          },
        };
      },
    })),
    select: jest.fn(() => ({
      from: (...args: any[]) => {
        mockSelectFrom(...args);
        return {
          where: (...w: any[]) => {
            mockSelectWhere(...w);
            return Promise.resolve([]);
          },
          orderBy: (...o: any[]) => {
            mockSelectOrderBy(...o);
            return {
              limit: (...l: any[]) => {
                mockSelectLimit(...l);
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    })),
  },
}));

jest.mock("@shared/schema", () => ({
  documentSimilarityCache: {
    id: "id",
    documentPairHash: "document_pair_hash",
    documentAId: "document_a_id",
    documentBId: "document_b_id",
    similarityScore: "similarity_score",
    lastUsed: "last_used",
    usageCount: "usage_count",
    createdAt: "created_at",
    updatedAt: "updated_at",
    criticalLevel: "critical_level",
  },
}));

jest.mock("../../storage", () => ({
  storage: {
    getDocumentsByProject: jest.fn().mockResolvedValue([]),
  },
}));

import { evictByAge, evictToCap, evictProjectToCap } from "../similarity-evict";
import { storage } from "../../storage";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("similarity-evict.ts", () => {
  test("evictByAge function exists", () => {
    expect(typeof evictByAge).toBe("function");
  });

  test("evictToCap function exists", () => {
    expect(typeof evictToCap).toBe("function");
  });

  test("evictProjectToCap function exists", () => {
    expect(typeof evictProjectToCap).toBe("function");
  });

  test("evictByAge returns a count of deleted rows", async () => {
    const result = await evictByAge(30);
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });

  test("evictToCap returns 0 when under cap", async () => {
    // Mock count query returns [{count: 5}]
    const { db } = require("../../db");
    db.select.mockReturnValueOnce({
      from: jest.fn().mockResolvedValue([{ count: 5 }]),
    });
    const result = await evictToCap(10000);
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });

  test("evictProjectToCap returns result shape with no docs", async () => {
    const result = await evictProjectToCap("proj", 100);
    expect(result).toEqual({
      projectId: "proj",
      total: 0,
      kept: 0,
      deleted: 0,
    });
  });

  test("evictProjectToCap calls storage.getDocumentsByProject", async () => {
    await evictProjectToCap("proj", 100);
    expect(storage.getDocumentsByProject).toHaveBeenCalledWith("proj");
  });
});
