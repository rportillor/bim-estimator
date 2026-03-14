/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  PDF EXTRACT NEW — Test Suite
 *  Tests: extractPdfTextAndPages, gatherContentForClaude
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock external / IO dependencies before importing the module under test
jest.mock("pdf-parse", () =>
  jest.fn(async (_buf: Buffer) => ({
    text: "Intro\n Page 1\nsite plan content\n Page 2\nparking detail",
  }))
);

jest.mock("../storage-file-resolver", () => ({
  loadFileBuffer: jest.fn(async (_key: string) => Buffer.from("fake-pdf")),
}));

const mockGetDocumentsByProject = jest.fn();
jest.mock("../../storage", () => ({
  storage: {
    getDocumentsByProject: mockGetDocumentsByProject,
  },
}));

import { extractPdfTextAndPages, gatherContentForClaude } from "../pdf-extract-new";
import type { StoredDoc } from "../pdf-extract-new";
import { loadFileBuffer } from "../storage-file-resolver";

describe("pdf-extract-new.ts", () => {
  afterEach(() => jest.clearAllMocks());

  // ── extractPdfTextAndPages ──────────────────────────────────────────────

  test("extractPdfTextAndPages function exists", () => {
    expect(typeof extractPdfTextAndPages).toBe("function");
  });

  test("StoredDoc type compliance", () => {
    const doc: StoredDoc = {
      id: "doc-003",
      name: "S-201.pdf",
      storageKey: "uploads/S-201.pdf",
    };
    expect(doc.id).toBe("doc-003");
  });

  test("returns empty result when storageKey is falsy", async () => {
    const result = await extractPdfTextAndPages({ id: "x", name: "x.pdf", storageKey: null });
    expect(result).toEqual({ pageTexts: [], fullText: "" });
    expect(loadFileBuffer).not.toHaveBeenCalled();
  });

  test("extracts pages from a PDF buffer", async () => {
    const result = await extractPdfTextAndPages({
      id: "d1",
      name: "plans.pdf",
      storageKey: "uploads/plans.pdf",
    });
    expect(loadFileBuffer).toHaveBeenCalledWith("uploads/plans.pdf");
    expect(result.fullText).toContain("Intro");
    expect(result.pageTexts.length).toBeGreaterThan(0);
  });

  // ── gatherContentForClaude ─────────────────────────────────────────────

  test("gatherContentForClaude function exists", () => {
    expect(typeof gatherContentForClaude).toBe("function");
  });

  test("gatherContentForClaude joins pages from all project documents", async () => {
    mockGetDocumentsByProject.mockResolvedValueOnce([
      { id: "d1", filename: "A-101.pdf", storageKey: "uploads/A-101.pdf" },
      { id: "d2", filename: "A-102.pdf", storageKey: "uploads/A-102.pdf" },
    ]);

    const result = await gatherContentForClaude("project-1");

    expect(mockGetDocumentsByProject).toHaveBeenCalledWith("project-1");
    // Result is a string of joined page content
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("gatherContentForClaude returns empty string when no documents", async () => {
    mockGetDocumentsByProject.mockResolvedValueOnce([]);
    const result = await gatherContentForClaude("empty-project");
    expect(result).toBe("");
  });
});
