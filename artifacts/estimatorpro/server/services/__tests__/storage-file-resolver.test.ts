/**
 * Storage File Resolver — Test Suite
 */

/* ------------------------------------------------------------------ */
/*  Mocks — must be declared before the module-under-test is imported */
/* ------------------------------------------------------------------ */

// Mock the DB module so importing it does not require DATABASE_URL
const mockDelete = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
const mockTransaction = jest.fn(async (cb: (_tx: any) => Promise<void>) => {
  await cb({ delete: mockDelete });
});
jest.mock("../../db", () => ({
  db: { transaction: mockTransaction },
}));

// Mock FileStorageService
const mockFileExists = jest.fn<boolean, [string]>();
const mockGetFilePath = jest.fn<string, [string]>();
jest.mock("../file-storage", () => ({
  FileStorageService: {
    fileExists: (rel: string) => mockFileExists(rel),
    getFilePath: (rel: string) => mockGetFilePath(rel),
  },
}));

// Mock fs/promises (dynamically imported inside loadFileBuffer)
const mockReadFile = jest.fn();
jest.mock("fs/promises", () => ({
  readFile: (p: string) => mockReadFile(p),
}));

/* ------------------------------------------------------------------ */
/*  Import the module under test AFTER the mocks are in place          */
/* ------------------------------------------------------------------ */
import { loadFileBuffer, deleteModelCascade } from "../storage-file-resolver";

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("storage-file-resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /* ===================== loadFileBuffer ===================== */

  describe("loadFileBuffer", () => {
    it("returns null for an empty storageKey", async () => {
      expect(await loadFileBuffer("")).toBeNull();
      expect(mockFileExists).not.toHaveBeenCalled();
    });

    it("returns a Buffer when a candidate path resolves", async () => {
      const fakeBuffer = Buffer.from("hello-pdf");

      // Only match the "uploads/<key>" candidate
      mockFileExists.mockImplementation((rel: string) =>
        rel === "uploads/A101.pdf"
      );
      mockGetFilePath.mockReturnValue("/storage/uploads/A101.pdf");
      mockReadFile.mockResolvedValue(fakeBuffer);

      const result = await loadFileBuffer("A101.pdf");

      expect(result).toEqual(fakeBuffer);
      expect(mockGetFilePath).toHaveBeenCalledWith("uploads/A101.pdf");
      expect(mockReadFile).toHaveBeenCalledWith("/storage/uploads/A101.pdf");
    });

    it("tries multiple candidates and returns the first success", async () => {
      const fakeBuffer = Buffer.from("data");

      // Reject the first candidates; accept "uploads/plans/2024/A101.pdf" or basename variant
      mockFileExists.mockImplementation((rel: string) =>
        rel === "uploads/A101.pdf"
      );
      mockGetFilePath.mockReturnValue("/store/uploads/A101.pdf");
      mockReadFile.mockResolvedValue(fakeBuffer);

      const result = await loadFileBuffer("plans/2024/A101.pdf");
      expect(result).toEqual(fakeBuffer);
    });

    it("returns null when no candidate matches", async () => {
      mockFileExists.mockReturnValue(false);

      const result = await loadFileBuffer("missing.pdf");
      expect(result).toBeNull();
    });

    it("returns null when readFile returns an empty buffer", async () => {
      mockFileExists.mockReturnValue(true);
      mockGetFilePath.mockReturnValue("/any/path");
      mockReadFile.mockResolvedValue(Buffer.alloc(0));

      const result = await loadFileBuffer("empty.pdf");
      expect(result).toBeNull();
    });

    it("skips candidates that throw and continues to the next", async () => {
      const fakeBuffer = Buffer.from("ok");
      let callCount = 0;

      mockFileExists.mockReturnValue(true);
      mockGetFilePath.mockReturnValue("/p");
      mockReadFile.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("disk error");
        return fakeBuffer;
      });

      const result = await loadFileBuffer("retry.pdf");
      expect(result).toEqual(fakeBuffer);
      expect(callCount).toBeGreaterThan(1);
    });
  });

  /* ================== deleteModelCascade ================== */

  describe("deleteModelCascade", () => {
    it("runs a transaction that deletes the model by id", async () => {
      await deleteModelCascade("model-42");

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalled();
    });

    it("propagates transaction errors", async () => {
      mockTransaction.mockRejectedValueOnce(new Error("tx failed"));
      await expect(deleteModelCascade("bad-id")).rejects.toThrow("tx failed");
    });
  });
});
