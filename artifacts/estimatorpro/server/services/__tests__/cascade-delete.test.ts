/**
 * CASCADE DELETE — Test Suite
 * Tests: safeDeleteModel, bulkDeleteModels
 */

// Mock the db module before any imports
const mockDelete = jest.fn();
const mockSelect = jest.fn();
const mockFrom = jest.fn();
const mockWhere = jest.fn();
const mockReturning = jest.fn();

const mockTx = {
  select: mockSelect,
  delete: mockDelete,
};

const mockTransaction = jest.fn();

jest.mock("../../db", () => ({
  db: {
    transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

jest.mock("@shared/schema", () => ({
  bimModels: { id: "id" },
  bimElements: { id: "id", modelId: "model_id" },
}));

import { safeDeleteModel, bulkDeleteModels } from "../cascade-delete";
import { BimError } from "../../middleware/error-handler";

// Helper: make mockTransaction invoke the callback with mockTx
function setupTransaction() {
  mockTransaction.mockImplementation(async (cb: Function) => cb(mockTx));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  // Default chain: tx.select().from().where() and tx.delete().where().returning()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockDelete.mockReturnValue({ where: mockWhere });
  // By default wire where -> returning for delete path
  mockWhere.mockReturnValue({ returning: mockReturning });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("safeDeleteModel", () => {
  test("is an exported function", () => {
    expect(typeof safeDeleteModel).toBe("function");
  });

  test("deletes a model and returns element count", async () => {
    setupTransaction();

    // First call to where (select elements) returns element rows
    // Second call to where (delete model) returns chain with returning
    let callCount = 0;
    mockWhere.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // select(...).from(...).where(...) — resolves to element rows
        return Promise.resolve([{ id: "e1" }, { id: "e2" }]);
      }
      // delete(...).where(...) — returns object with .returning()
      return {
        returning: mockReturning.mockResolvedValue([{ id: "model-1" }]),
      };
    });

    const result = await safeDeleteModel("model-1");

    expect(result).toEqual({ deleted: true, elementsDeleted: 2 });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalled();
  });

  test("throws BimError 404 when model not found", async () => {
    setupTransaction();

    let callCount = 0;
    mockWhere.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([]);
      }
      return {
        returning: mockReturning.mockResolvedValue([]),
      };
    });

    await expect(safeDeleteModel("missing")).rejects.toThrow(BimError);
    await expect(safeDeleteModel("missing")).rejects.toMatchObject({
      statusCode: 404,
      code: "MODEL_NOT_FOUND",
    });
  });

  test("wraps unexpected errors in BimError 500", async () => {
    mockTransaction.mockRejectedValue(new Error("connection lost"));

    await expect(safeDeleteModel("model-1")).rejects.toThrow(BimError);
    await expect(safeDeleteModel("model-1")).rejects.toMatchObject({
      statusCode: 500,
      code: "DELETE_MODEL_FAILED",
    });
  });

  test("re-throws BimError without wrapping", async () => {
    const original = new BimError("Model not found", 404, "MODEL_NOT_FOUND");
    mockTransaction.mockRejectedValue(original);

    await expect(safeDeleteModel("model-1")).rejects.toBe(original);
  });
});

describe("bulkDeleteModels", () => {
  test("is an exported function", () => {
    expect(typeof bulkDeleteModels).toBe("function");
  });

  test("deletes multiple models and aggregates results", async () => {
    setupTransaction();

    let callCount = 0;
    mockWhere.mockImplementation(() => {
      callCount++;
      // Odd calls are select (elements), even calls are delete (model)
      if (callCount % 2 === 1) {
        return Promise.resolve([{ id: "e1" }]);
      }
      return {
        returning: mockReturning.mockResolvedValue([{ id: `m${callCount}` }]),
      };
    });

    const result = await bulkDeleteModels(["m1", "m2", "m3"]);

    expect(result).toEqual({ deleted: 3, elementsDeleted: 3 });
  });

  test("continues past failures and counts only successes", async () => {
    // First call succeeds, second fails, third succeeds
    let invocation = 0;
    mockTransaction.mockImplementation(async (cb: Function) => {
      invocation++;
      if (invocation === 2) {
        throw new Error("db down");
      }

      let callCount = 0;
      const localWhere = () => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ id: "e" }]);
        return { returning: jest.fn().mockResolvedValue([{ id: "ok" }]) };
      };

      const localTx = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({ where: localWhere }),
        }),
        delete: jest.fn().mockReturnValue({ where: localWhere }),
      };
      return cb(localTx);
    });

    const result = await bulkDeleteModels(["a", "b", "c"]);

    expect(result).toEqual({ deleted: 2, elementsDeleted: 2 });
  });

  test("returns zeros for empty input", async () => {
    const result = await bulkDeleteModels([]);
    expect(result).toEqual({ deleted: 0, elementsDeleted: 0 });
  });
});
