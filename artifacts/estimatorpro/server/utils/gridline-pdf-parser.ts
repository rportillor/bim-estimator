/**
 * Gridline PDF Spatial Parser — v3.0
 *
 * Uses pdf.js-extract to get the exact x,y canvas position of every text item,
 * then derives grid-line coordinates from those positions.
 *
 * Architectural convention in this drawing
 * ─────────────────────────────────────────
 * Letter labels  (A, B … Y, Ga, Sa)  — appear at the TOP row (y≈93) AND BOTTOM
 *   row of the drawing at the SAME x-position. They mark VERTICAL lines that run
 *   North–South. Each label's E-W coordinate is read from its x-position.
 *   → axis = 'X'  (Three.js: line at fixed X, runs along Z)
 *
 * CL labels  (CLa, CL, CLb)  — same family as letter labels but angled 13.58°.
 *   → axis = 'X', angle_deg = 13.58
 *
 * Number labels  (1 … 11)  — appear on the LEFT edge of the drawing at varying
 *   y-positions. They mark HORIZONTAL lines that run East–West.
 *   Each label's N-S coordinate is read from its y-position.
 *   → axis = 'Y'  (Three.js: line at fixed Z, runs along X)
 *
 * Scale calibration
 * ─────────────────
 * A→B spacing = 4 710 mm (consistently annotated in the drawing).
 * A is at PDF x=211, B at PDF x=345  →  134 PDF units → 4 710 mm.
 * Scale = 35.149 mm / PDF-unit.
 *
 * Viewer axis reminder (viewer-3d.tsx)
 * ──────────────────────────────────────
 *   axis='X' → Three.js X = coord_m (E-W position); line runs along Three.js Z (N-S).
 *   axis='Y' → Three.js Z = coord_m (N-S position); line runs along Three.js X (E-W).
 *
 * With this convention the intersection of letter-A (axis='X', coord=0) and
 * number-1 (axis='Y', coord=0) is at Three.js (0, elevation, 0) — the world origin.
 */

export interface ParsedGridLine {
  label: string;
  axis: 'X' | 'Y';
  coordinate_m: number;
  start_m: number;
  end_m: number;
  angle_deg: number;
}

export interface GridlineParsedResult {
  grid_lines: ParsedGridLine[];
  confidence: 'high' | 'low';
  notes: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Token classifiers
// ─────────────────────────────────────────────────────────────────────────────

const LETTER_LABEL_RE = /^[A-HJ-NP-Z][a-z]?$/;   // e.g. A, B, Ga, Sa (skips I, O)
const CL_LABEL_RE     = /^CL[a-z]?$/;             // CLa, CLb, CL
const NUM_LABEL_RE    = /^\d{1,2}$/;              // 1–25
const ANGLE_RE        = /^\d{1,2}\.\d{1,2}$/;    // e.g. 13.58

function isLetterLabel(s: string) { return LETTER_LABEL_RE.test(s); }
function isClLabel(s: string)     { return CL_LABEL_RE.test(s); }
function isNumLabel(s: string)    {
  if (!NUM_LABEL_RE.test(s)) return false;
  const n = parseInt(s, 10);
  return n >= 1 && n <= 25;
}
function isAngleAnnotation(s: string) {
  if (!ANGLE_RE.test(s)) return false;
  const v = parseFloat(s);
  return v > 0 && v < 90;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export async function parseGridlinesFromPdf(
  pdfBuffer: Buffer,
): Promise<GridlineParsedResult | null> {
  const notes: string[] = [];

  // ── Extract content items with spatial positions ──────────────────────────
  let items: any[] = [];
  try {
    // Dynamically import to avoid top-level type-import issues
    const pdfExtractModule = await import('pdf.js-extract');
    const PDFExtract = pdfExtractModule.PDFExtract;
    const extractor = new PDFExtract();

    const data: any = await new Promise((resolve, reject) => {
      extractor.extractBuffer(pdfBuffer, {}, (err: any, result: any) => {
        if (err) reject(err); else resolve(result);
      });
    });

    items = data?.pages?.[0]?.content ?? [];
  } catch (e: any) {
    notes.push(`pdf.js-extract error: ${e?.message}`);
    return null;
  }

  if (items.length < 10) {
    notes.push(`Too few PDF items: ${items.length}`);
    return null;
  }

  notes.push(`PDF items: ${items.length}`);

  // ── Keep only items with meaningful height (grid bubbles are typically ≥ 10) ──
  const gridItems: any[] = items.filter((i: any) => (i.height ?? 0) >= 10);
  notes.push(`Items h≥10: ${gridItems.length}`);

  // ── Scale calibration: locate label 'A' and 'B' in the top row ───────────
  const rawA = gridItems.filter((i: any) => i.str?.trim() === 'A');
  const rawB = gridItems.filter((i: any) => i.str?.trim() === 'B');

  if (rawA.length === 0 || rawB.length === 0) {
    notes.push(`Could not find A (${rawA.length}) or B (${rawB.length}) labels`);
    return { grid_lines: [], confidence: 'low', notes };
  }

  // Take the topmost occurrence (smallest y = north = top of page)
  const aRef: any = [...rawA].sort((a, b) => a.y - b.y)[0];
  const bRef: any = [...rawB].sort((a, b) => a.y - b.y)[0];
  const abDiff = bRef.x - aRef.x;

  if (abDiff <= 0) {
    notes.push(`A-B x-diff is non-positive (${abDiff}); cannot calibrate scale`);
    return { grid_lines: [], confidence: 'low', notes };
  }

  const AB_MM    = 4710;
  const SCALE    = AB_MM / abDiff;           // mm per PDF unit
  const toM      = (u: number) => parseFloat((u * SCALE / 1000).toFixed(4));
  notes.push(`Scale: ${SCALE.toFixed(3)} mm/unit  (A x=${Math.round(aRef.x)}, B x=${Math.round(bRef.x)}, diff=${Math.round(abDiff)})`);

  // ── 1.  Letter labels → axis='X'  (vertical N-S lines at fixed E-W position) ──
  // Use items that appear in the TOP BAND (y close to aRef.y) to get unique labels.
  const TOP_Y    = aRef.y;
  const TOP_BAND = 120; // PDF units of tolerance around the top label row

  const seenLetters = new Set<string>();
  const topLetters: any[] = [];
  const topCLs: any[]     = [];

  for (const item of gridItems) {
    const s = item.str?.trim() ?? '';
    if (item.y > TOP_Y + TOP_BAND) continue;         // below the top band
    if (isLetterLabel(s) && !seenLetters.has(s)) {
      seenLetters.add(s);
      topLetters.push(item);
    } else if (isClLabel(s) && !seenLetters.has(s)) {
      seenLetters.add(s);
      topCLs.push(item);
    }
  }

  topLetters.sort((a, b) => a.x - b.x);
  topCLs.sort((a, b) => a.x - b.x);
  notes.push(`Top-band letter labels (${topLetters.length}): ${topLetters.map((i: any) => i.str.trim()).join(', ')}`);
  notes.push(`Top-band CL labels    (${topCLs.length}): ${topCLs.map((i: any) => i.str.trim()).join(', ')}`);

  // ── 2.  Number labels → axis='Y'  (horizontal E-W lines at fixed N-S position) ──
  // Numbers appear on the LEFT edge of the drawing (smallest x cluster).
  const allNums = gridItems.filter((i: any) => isNumLabel(i.str?.trim() ?? ''));
  const leftX   = allNums.length > 0 ? Math.min(...allNums.map((i: any) => i.x)) : 0;
  const LEFT_BAND = 80;

  const seenNums = new Set<string>();
  const leftNumbers: any[] = [];

  for (const item of allNums) {
    const s = item.str.trim();
    if (item.x > leftX + LEFT_BAND) continue;       // not in the left column
    if (!seenNums.has(s)) {
      seenNums.add(s);
      leftNumbers.push(item);
    }
  }

  leftNumbers.sort((a, b) => a.y - b.y);            // north → south (smallest y first)
  notes.push(`Left-column number labels (${leftNumbers.length}): ${leftNumbers.map((i: any) => i.str.trim()).join(', ')}`);

  // ── 3.  Detect angle annotation for CL lines ─────────────────────────────
  let clAngleDeg = 0;
  const angleFreq = new Map<number, number>();
  for (const item of items) {
    const s = item.str?.trim() ?? '';
    if (isAngleAnnotation(s)) {
      const v = parseFloat(s);
      angleFreq.set(v, (angleFreq.get(v) ?? 0) + 1);
    }
  }
  if (angleFreq.size > 0) {
    clAngleDeg = [...angleFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    notes.push(`CL angle: ${clAngleDeg}°`);
  }

  // ── 4.  Compute extents for start_m / end_m ───────────────────────────────
  // Letter (axis='X') lines run N-S → their extent = N-S range of number labels
  // Number (axis='Y') lines run E-W → their extent = E-W range of letter labels
  const nsExtentM = leftNumbers.length > 0
    ? toM(leftNumbers[leftNumbers.length - 1].y - leftNumbers[0].y)
    : 50;
  const ewExtentM = topLetters.length > 0
    ? toM(topLetters[topLetters.length - 1].x - aRef.x)
    : 50;

  const NS_END = parseFloat((nsExtentM * 1.02).toFixed(3));
  const EW_END = parseFloat((ewExtentM * 1.02).toFixed(3));

  // ── 5.  Build output ──────────────────────────────────────────────────────
  const grid_lines: ParsedGridLine[] = [];
  const nsOriginY = leftNumbers[0]?.y ?? 0;

  // Letter labels: axis='X', E-W coordinate from x-position
  for (const item of topLetters) {
    grid_lines.push({
      label:        item.str.trim(),
      axis:         'X',
      coordinate_m: toM(item.x - aRef.x),
      start_m:      0,
      end_m:        NS_END,
      angle_deg:    0,
    });
  }

  // Number labels: axis='Y', N-S coordinate from y-position
  for (const item of leftNumbers) {
    grid_lines.push({
      label:        item.str.trim(),
      axis:         'Y',
      coordinate_m: toM(item.y - nsOriginY),
      start_m:      0,
      end_m:        EW_END,
      angle_deg:    0,
    });
  }

  // CL labels: axis='X', angled
  for (const item of topCLs) {
    grid_lines.push({
      label:        item.str.trim(),
      axis:         'X',
      coordinate_m: toM(item.x - aRef.x),
      start_m:      0,
      end_m:        NS_END,
      angle_deg:    clAngleDeg,
    });
  }

  const total = grid_lines.length;
  const confidence: 'high' | 'low' = total >= 5 ? 'high' : 'low';
  notes.push(`Total: ${total} grid lines  (${topLetters.length} letter + ${leftNumbers.length} number + ${topCLs.length} CL)`);

  return { grid_lines, confidence, notes };
}
