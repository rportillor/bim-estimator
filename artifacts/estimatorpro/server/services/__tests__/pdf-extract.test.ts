/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PDF EXTRACT — Test Suite
 *  Tests: StoredDoc type, extractPdfTextAndPages behaviour
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock external / IO dependencies before importing the module under test
jest.mock("pdf-parse", () =>
  jest.fn(async (_buf: Buffer) => ({
    text: "Intro text\n Page 1\nFirst page content\n Page 2\nSecond page content",
  }))
);

jest.mock("../storage-file-resolver", () => ({
  loadFileBuffer: jest.fn(async (_key: string) => Buffer.from("fake-pdf")),
}));

import { extractPdfTextAndPages } from "../pdf-extract";
import type { StoredDoc } from "../pdf-extract";
import { loadFileBuffer } from "../storage-file-resolver";

describe("pdf-extract.ts", () => {
  afterEach(() => jest.clearAllMocks());

  test("extractPdfTextAndPages function exists", () => {
    expect(typeof extractPdfTextAndPages).toBe("function");
  });

  test("StoredDoc type compliance", () => {
    const doc: StoredDoc = {
      id: "doc-001",
      name: "A-101.pdf",
      storageKey: "uploads/A-101.pdf",
    };
    expect(doc.id).toBe("doc-001");
    expect(doc.name).toBe("A-101.pdf");
  });

  test("StoredDoc with null storageKey is valid", () => {
    const doc: StoredDoc = {
      id: "doc-002",
      name: "spec.pdf",
      storageKey: null,
    };
    expect(doc.storageKey).toBeNull();
  });

  test("returns empty result when storageKey is falsy", async () => {
    const result = await extractPdfTextAndPages({ id: "x", name: "x.pdf", storageKey: null });
    expect(result).toEqual({ pageTexts: [], fullText: "" });
    expect(loadFileBuffer).not.toHaveBeenCalled();
  });

  test("returns empty result when loadFileBuffer returns null", async () => {
    (loadFileBuffer as jest.Mock).mockResolvedValueOnce(null);
    const result = await extractPdfTextAndPages({ id: "x", name: "x.pdf", storageKey: "k" });
    expect(result).toEqual({ pageTexts: [], fullText: "" });
  });

  test("extracts pages and fullText from a PDF buffer", async () => {
    const result = await extractPdfTextAndPages({
      id: "doc-1",
      name: "plans.pdf",
      storageKey: "uploads/plans.pdf",
    });

    expect(loadFileBuffer).toHaveBeenCalledWith("uploads/plans.pdf");
    expect(result.fullText).toContain("Intro text");
    expect(result.pageTexts.length).toBeGreaterThan(0);
  });
});
