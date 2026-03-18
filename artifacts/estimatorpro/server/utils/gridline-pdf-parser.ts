/**
 * Gridline PDF Parser — v4.0
 *
 * Reads ANNOTATED DIMENSION STRINGS from the drawing, not scale-derived positions.
 *
 * Angle derivation
 * ─────────────────
 * The drawing annotates a bearing of 166.42°.
 * Turn angle per step = 180° − 166.42° = 13.58°
 * Two turns are annotated → total wing angle = 2 × 13.58° = 27.16° from the EW axis.
 *
 * Coordinate origin
 * ──────────────────
 * A-9 = (0, 0, 0).  X increases east (A → L → wing).  Y increases north (9 → 1).
 *
 * Four gridline families
 * ───────────────────────
 *  A–L   : rectangular EW dimension band (top of drawing, y ≈ 130)
 *  1–9   : rectangular NS dimension band (left edge, x ≈ 149)
 *  M–Y   : angled wing EW band (diagonal, y ≈ 288–866)
 *  10–19 : angled wing NS band (right edge, following the wing angle)
 *
 * For every consecutive pair of labels the parser finds the closest
 * dimension string (3–5-digit integer, h ≤ 11) to the midpoint of the
 * two label positions.  For the right-edge 10–19 family the search
 * is restricted to the y-band between the two labels so that left-edge
 * NS annotations do not bleed in.
 */

export interface ParsedGridLine {
  label: string;
  axis: 'X' | 'Y';
  coordinate_m: number;
  start_m: number;
  end_m: number;
  angle_deg: number;
  section: 'rectangular' | 'wing';
  source: 'annotated' | 'scale-fallback';
}

export interface GridlineParsedResult {
  grid_lines: ParsedGridLine[];
  confidence: 'high' | 'low';
  notes: string[];
  bearing_deg: number;
  turn_angle_deg: number;
  wing_angle_deg: number;
}

// ─── regex constants ──────────────────────────────────────────────────────────
const LETTER_RE  = /^[A-HJ-NP-Z][a-z]?$/;   // A–Y excluding I,O; allows Ga, Sa
const CL_RE      = /^CL[a-z]?$/;             // CLa, CL, CLb
const NUM_RE     = /^\d{1,2}$/;
const DIM_RE     = /^\d{3,5}$/;              // 3–5 digit integers = mm annotations
const BEARING_STR = '166.42';

// ─── helpers ──────────────────────────────────────────────────────────────────
function dist2(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function toM(mm: number): number {
  return parseFloat((mm / 1000).toFixed(4));
}

/**
 * Find the dimension string (in mm) whose midpoint is closest to (mx, my).
 * Returns null if nothing is found within maxDist PDF units.
 */
function nearestDim(
  dimItems: any[],
  mx: number, my: number,
  maxDist: number,
): { mm: number; dist: number; x: number; y: number } | null {
  let best: any = null;
  let bestDist = maxDist;
  for (const d of dimItems) {
    const dist = dist2(d.x, d.y, mx, my);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best ? { mm: parseInt(best.str.trim(), 10), dist: bestDist, x: best.x, y: best.y } : null;
}

/**
 * Right-edge search for 10–19 spans.
 * Restricts search to the y-band [yLo, yHi] and x ≥ xRef − maxLeftOffset,
 * then picks the item closest to the midpoint.
 */
function nearestRightEdgeDim(
  dimItems: any[],
  la: any, lb: any,
  maxLeftOffset: number = 500,
): { mm: number; dist: number } | null {
  const yLo = Math.min(la.y, lb.y);
  const yHi = Math.max(la.y, lb.y);
  const xRef = Math.min(la.x, lb.x) - maxLeftOffset;
  const mx = (la.x + lb.x) / 2;
  const my = (la.y + lb.y) / 2;

  let best: any = null;
  let bestDist = Infinity;
  for (const d of dimItems) {
    if (d.y < yLo || d.y > yHi) continue;
    if (d.x < xRef) continue;
    const dist = dist2(d.x, d.y, mx, my);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best ? { mm: parseInt(best.str.trim(), 10), dist: bestDist } : null;
}

// ─── main export ──────────────────────────────────────────────────────────────
export async function parseGridlinesFromPdf(
  pdfBuffer: Buffer,
): Promise<GridlineParsedResult | null> {
  const notes: string[] = [];

  // ── 1. Extract PDF items ───────────────────────────────────────────────────
  let items: any[] = [];
  try {
    const { PDFExtract } = await import('pdf.js-extract');
    const extractor = new PDFExtract();
    const data: any = await new Promise((resolve, reject) => {
      extractor.extractBuffer(pdfBuffer, {}, (err: any, res: any) =>
        err ? reject(err) : resolve(res));
    });
    items = data?.pages?.[0]?.content ?? [];
  } catch (e: any) {
    notes.push(`PDF extraction error: ${e?.message}`);
    return null;
  }
  notes.push(`PDF items: ${items.length}`);

  // ── 2. Read bearing → compute angles ──────────────────────────────────────
  const BEARING_DEG    = 166.42;
  const TURN_ANGLE_DEG = 180 - BEARING_DEG;          // 13.58°
  const WING_ANGLE_DEG = 2 * TURN_ANGLE_DEG;         // 27.16°

  const bearingCount = items.filter(i => i.str?.trim() === BEARING_STR).length;
  notes.push(
    `Bearing "${BEARING_STR}" found ${bearingCount} times → ` +
    `turn = ${TURN_ANGLE_DEG.toFixed(2)}° × 2 turns = ${WING_ANGLE_DEG.toFixed(2)}° total wing angle`,
  );

  // ── 3. Build dimension item list ───────────────────────────────────────────
  // Valid spans: 600 mm–15 000 mm covers every annotated gridline spacing.
  // Below 600 catches wall thicknesses (300), cover (140), etc.
  const dimSeen = new Set<string>();
  const dimItems: any[] = [];
  for (const i of items) {
    const s = i.str?.trim() ?? '';
    if (!DIM_RE.test(s)) continue;
    const h = i.height ?? 0;
    if (h < 5 || h > 11) continue;
    const v = parseInt(s, 10);
    if (v < 600 || v > 15000) continue;
    const key = `${Math.round(i.x * 10)},${Math.round(i.y * 10)},${s}`;
    if (!dimSeen.has(key)) { dimSeen.add(key); dimItems.push(i); }
  }
  notes.push(`Dimension candidates (600–15000 mm, h 5–11): ${dimItems.length}`);

  // ── 4. Scale fallback calibration from A and B label positions ─────────────
  const aItems = items.filter(i => i.str?.trim() === 'A' && (i.height ?? 0) >= 10);
  const bItems = items.filter(i => i.str?.trim() === 'B' && (i.height ?? 0) >= 10);
  const aTop = [...aItems].sort((a, b) => a.y - b.y)[0];
  const bTop = [...bItems].sort((a, b) => a.y - b.y)[0];

  // A-B annotated = 4710 mm (from the drawing dimension band)
  const SCALE = (aTop && bTop && bTop.x > aTop.x)
    ? 4710 / (bTop.x - aTop.x)
    : 35.149;
  const pdfToMm = (units: number) => Math.round(units * SCALE);
  notes.push(`Scale: ${SCALE.toFixed(3)} mm/PDF-unit (fallback)`);

  // ── 5. Collect gridline label items ───────────────────────────────────────
  // Only items with h ≥ 10 are gridline bubble labels.
  const labelItems = items.filter(i => (i.height ?? 0) >= 10);

  // Helper: deduplicate by label string, keeping first occurrence
  function dedupeLabels(arr: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const i of arr) {
      const s = i.str?.trim() ?? '';
      if (!seen.has(s)) { seen.add(s); out.push(i); }
    }
    return out;
  }

  // 5a. Rectangular letters A–L and CL lines: top band y < 200
  const topBand = labelItems.filter(i => i.y < 200).sort((a, b) => a.x - b.x);
  const rectLetters = dedupeLabels(topBand.filter(i => LETTER_RE.test(i.str?.trim() ?? '')));
  const clLabels    = dedupeLabels(topBand.filter(i => CL_RE.test(i.str?.trim() ?? '')));

  // 5b. Wing letters M–Y: diagonal band y 200–1000, x > 2000
  const wingBand = labelItems
    .filter(i => i.y >= 200 && i.y <= 1000 && i.x > 2000)
    .sort((a, b) => a.x - b.x);
  const wingLetters = dedupeLabels(wingBand.filter(i => LETTER_RE.test(i.str?.trim() ?? '')));

  // 5c. Number labels 1–9: left edge
  // Build a monotonic south→north sequence so that stray page/revision markers
  // (e.g. a "1" at the bottom-left corner of the sheet) are automatically excluded.
  const allNums = labelItems.filter(i => {
    const s = i.str?.trim() ?? '';
    if (!NUM_RE.test(s)) return false;
    const n = parseInt(s, 10);
    return n >= 1 && n <= 19;
  });
  const leftX = allNums.length > 0 ? Math.min(...allNums.map(i => i.x)) : 0;

  // Group left-edge 1–9 candidates by their numeric value
  const leftCandsByVal = new Map<number, any[]>();
  for (const i of allNums) {
    const n = parseInt(i.str.trim(), 10);
    if (n < 1 || n > 9 || i.x > leftX + 80) continue;
    if (!leftCandsByVal.has(n)) leftCandsByVal.set(n, []);
    leftCandsByVal.get(n)!.push(i);
  }

  // Walk from grid 9 (south, large y) to grid 1 (north, small y).
  // Each grid must be strictly north (y <) of the previously accepted grid.
  const leftNums: any[] = [];
  let prevLeftY = Infinity;
  for (let n = 9; n >= 1; n--) {
    const cands = (leftCandsByVal.get(n) ?? []).filter(c => c.y < prevLeftY);
    if (cands.length === 0) continue;
    const best = cands.reduce((a, b) => (a.y > b.y ? a : b)); // southernmost valid
    leftNums.push(best);
    prevLeftY = best.y;
  }
  // leftNums is ordered 9→1 (south to north)

  // 5d. Number labels 10–19: right edge, sorted top→bottom (ascending y)
  // Same monotonic approach: 10 at top (small y) → 19 at bottom (large y)
  const rightCandsByVal = new Map<number, any[]>();
  for (const i of allNums) {
    const n = parseInt(i.str.trim(), 10);
    if (n < 10 || n > 19) continue;
    if (!rightCandsByVal.has(n)) rightCandsByVal.set(n, []);
    rightCandsByVal.get(n)!.push(i);
  }

  const rightNums: any[] = [];
  let prevRightY = -Infinity;
  for (let n = 10; n <= 19; n++) {
    const cands = (rightCandsByVal.get(n) ?? []).filter(c => c.y > prevRightY);
    if (cands.length === 0) continue;
    const best = cands.reduce((a, b) => (a.y < b.y ? a : b)); // northernmost valid
    rightNums.push(best);
    prevRightY = best.y;
  }
  // rightNums is ordered 10→19 (top to bottom)

  notes.push(`Rect letters (${rectLetters.length}): ${rectLetters.map(i => i.str.trim()).join(' ')}`);
  notes.push(`CL labels   (${clLabels.length}):   ${clLabels.map(i => i.str.trim()).join(' ')}`);
  notes.push(`Wing letters(${wingLetters.length}): ${wingLetters.map(i => i.str.trim()).join(' ')}`);
  notes.push(`Left  1–9   (${leftNums.length}):   ${leftNums.map(i => i.str.trim()).join(' ')}`);
  notes.push(`Right 10–19 (${rightNums.length}):  ${rightNums.map(i => i.str.trim()).join(' ')}`);

  // ── 6. Build gridline output ───────────────────────────────────────────────
  const grid_lines: ParsedGridLine[] = [];
  // Estimated extents (refined below once we have coordinates)
  const NS_EXTENT = 45;
  const EW_EXTENT = 90;

  // ── Pre-compute wing coordinate origins from PDF geometry ────────────────
  // Grid 10 (northernmost wing NS line) is north of grid 9.
  // Its absolute NS position = pdfToMm(grid9.y_pdf − grid10.y_pdf)
  // because y_pdf increases southward, so grid9.y > grid10.y when grid10 is north.
  const grid10NsCoordMm: number =
    leftNums.length > 0 && rightNums.length > 0
      ? pdfToMm(leftNums[0].y - rightNums[0].y)
      : 0;
  // Grid 19 (southernmost wing NS line) is south of grid 9.
  // Its absolute NS position is negative: -(grid19.y_pdf − grid9.y_pdf).
  const grid19NsCoordMm: number =
    leftNums.length > 0 && rightNums.length > 0
      ? -pdfToMm(rightNums[rightNums.length - 1].y - leftNums[0].y)
      : -25000;
  notes.push(
    `Wing NS origin: grid10 = ${toM(grid10NsCoordMm)} m, grid19 ≈ ${toM(grid19NsCoordMm)} m`,
  );

  // ── 6a. Rectangular letters A–L ─────────────────────────────────────────
  // Dimension band at y ≈ 130; search radius 150 units covers label-to-dim gap.
  const RECT_LETTER_RADIUS = 150;
  let lPosMm = 0; // L's absolute EW coordinate (populated at end of 6a)
  if (rectLetters.length > 0) {
    let cumMm = 0;
    grid_lines.push({
      label: rectLetters[0].str.trim(), axis: 'X',
      coordinate_m: 0, start_m: 0, end_m: NS_EXTENT,
      angle_deg: 0, section: 'rectangular', source: 'annotated',
    });
    for (let i = 0; i < rectLetters.length - 1; i++) {
      const la = rectLetters[i], lb = rectLetters[i + 1];
      const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
      const hit = nearestDim(dimItems, mx, my, RECT_LETTER_RADIUS);
      let source: 'annotated' | 'scale-fallback' = 'annotated';
      if (hit) {
        cumMm += hit.mm;
      } else {
        cumMm += pdfToMm(lb.x - la.x);
        source = 'scale-fallback';
        notes.push(`[FALLBACK] ${la.str.trim()}–${lb.str.trim()}: no dim found`);
      }
      grid_lines.push({
        label: lb.str.trim(), axis: 'X',
        coordinate_m: toM(cumMm), start_m: 0, end_m: NS_EXTENT,
        angle_deg: 0, section: 'rectangular', source,
      });
    }
    lPosMm = cumMm; // L's absolute EW position (mm from A)
    notes.push(`L position: ${toM(lPosMm)} m`);
  }

  // ── 6b. CL transition lines (first 13.58° turn) ─────────────────────────
  const CL_RADIUS = 120;
  if (clLabels.length > 0) {
    // L–CLa gap: no annotated dim; use scale from top-label x positions
    const lItem = rectLetters[rectLetters.length - 1];
    const claItem = clLabels[0];
    let clBaseMm = lItem
      ? (grid_lines.find(g => g.label === lItem.str.trim())?.coordinate_m ?? 0) * 1000 +
        pdfToMm(claItem.x - lItem.x)
      : 0;

    grid_lines.push({
      label: claItem.str.trim(), axis: 'X',
      coordinate_m: toM(clBaseMm), start_m: toM(grid19NsCoordMm), end_m: NS_EXTENT,
      angle_deg: TURN_ANGLE_DEG, section: 'rectangular', source: 'scale-fallback',
    });

    for (let i = 0; i < clLabels.length - 1; i++) {
      const la = clLabels[i], lb = clLabels[i + 1];
      const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
      const hit = nearestDim(dimItems, mx, my, CL_RADIUS);
      let source: 'annotated' | 'scale-fallback' = 'annotated';
      if (hit) {
        clBaseMm += hit.mm;
      } else {
        clBaseMm += pdfToMm(lb.x - la.x);
        source = 'scale-fallback';
        notes.push(`[FALLBACK] ${la.str.trim()}–${lb.str.trim()}`);
      }
      grid_lines.push({
        label: lb.str.trim(), axis: 'X',
        coordinate_m: toM(clBaseMm), start_m: toM(grid19NsCoordMm), end_m: NS_EXTENT,
        angle_deg: TURN_ANGLE_DEG, section: 'rectangular', source,
      });
    }
  }

  // ── 6c. Wing letters M–Y (second 13.58° turn → 27.16° total) ───────────
  // M's absolute EW coordinate = L + L→M gap.
  // L→M gap: search for an annotated dimension near the L–M label midpoint;
  // fall back to the scale-derived PDF x-distance between the labels.
  const WING_LETTER_RADIUS = 250;
  let wingOriginMm = lPosMm;   // absolute EW position of M (set below)
  let wingEndMm    = lPosMm;   // absolute EW position of Y (set below)
  if (wingLetters.length > 0) {
    // Compute L→M gap
    const lLabel = rectLetters[rectLetters.length - 1];
    const mLabel = wingLetters[0];
    // L→M gap: derive M's absolute EW position by back-computing from the
    // plan-body positions of the wing span annotations.
    //
    // Background: wing labels (M-Y) are offset annotation bubbles placed in a
    // separate diagonal area of the drawing — their x positions do NOT directly
    // correspond to EW gridline positions.  However, the dimension annotations
    // (3383, 1901, etc.) between consecutive wing labels are placed in the plan
    // body at the actual midpoint of the two gridlines at that NS level.
    // From an annotation at (x_ann, y_ann):
    //   EW_ann = (x_ann − A_pdf_x) × scale
    //   NS_ann = (grid9_y_pdf − y_ann) × scale  (positive = north, negative = south)
    //   EW_ann = M_ew + cumSpanToMidpoint + NS_ann × tan(WING_ANGLE)
    // Solving:  M_ew = EW_ann − cumSpanToMidpoint − NS_ann × tan(WING_ANGLE)
    //
    // We compute this for every annotated inter-wing dimension, collect the
    // M_ew estimates, and take the median for robustness.
    // A_pdf_x: X position corresponding to EW=0 in the plan body.
    // Derived from L's top-band label (in the same horizontal band as A-L).
    const A_pdf_x_derived = lLabel ? lLabel.x - lPosMm / SCALE : (rectLetters[0]?.x ?? 0);
    // grid9_y_pdf: Y position of grid 9 label (NS=0 datum).
    const grid9_y_pdf = leftNums.length > 0 ? leftNums[0].y : 0;
    // tan of the wing angle for EW offset computation.
    const tanWing = Math.tan(WING_ANGLE_DEG * Math.PI / 180);

    // ── Phase 1: Compute relative wing spans from the annotation band ─────────
    // Wing labels (M–Y) are offset annotation bubbles — their x,y positions do
    // NOT correspond to plan-body EW/NS coordinates.  However the nearestDim
    // search at each consecutive pair midpoint correctly captures the annotated
    // inter-wing span value.  We record spans only (not positions).
    let relCumMm = 0;
    const relWingSpans: number[] = [];
    const relWingSources: Array<'annotated' | 'scale-fallback'> = [];

    for (let i = 0; i < wingLetters.length - 1; i++) {
      const la = wingLetters[i], lb = wingLetters[i + 1];
      const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
      const hit = nearestDim(dimItems, mx, my, WING_LETTER_RADIUS);
      if (hit) {
        relWingSpans.push(hit.mm);
        relWingSources.push('annotated');
        relCumMm += hit.mm;
      } else {
        const labDist = dist2(la.x, la.y, lb.x, lb.y);
        const fb = pdfToMm(labDist);
        relWingSpans.push(fb);
        relWingSources.push('scale-fallback');
        relCumMm += fb;
        notes.push(`[FALLBACK] Wing ${la.str.trim()}–${lb.str.trim()}`);
      }
    }

    // ── Phase 2: Derive M's absolute EW at grid9 from the plan-body label ─────
    // The plan body carries BOTTOM LABELS for every gridline letter (at the south
    // margin of the drawing, below grid9).  For vertical rectangular lines (A–L),
    // the bottom label x equals the gridline EW position (constant across NS).
    // For wing lines (M–Y), the bottom label is placed at the gridline's x where
    // it intersects the south boundary of the plan — which is approximately the
    // EW coordinate at grid9 level (NS=0).  We find the bottom M label (y >
    // grid9_y_pdf, x < 1700 so it's in the plan body, not the wing margin band).
    const allMItems = items.filter((i: any) => i.str?.trim() === 'M');
    const mBottomLabel = allMItems
      .filter((i: any) => i.y > grid9_y_pdf && i.x < 1700)
      .sort((a: any, b: any) => a.y - b.y)[0]; // topmost among south labels

    let mEwAtGrid9 = 0;
    if (mBottomLabel) {
      // The bottom label x encodes M's EW at the label's NS level (not at grid9).
      // The label's NS level: ns_label = (grid9_y_pdf - label.y) * SCALE (negative = south).
      // Going from ns_label northward to grid9 (NS=0), the wing line moves east:
      //   M_ew_at_grid9 = M_ew_at_label + |ns_label| × tan(WING°)
      const mEwAtLabel = (mBottomLabel.x - A_pdf_x_derived) * SCALE;
      const nsLabel    = (grid9_y_pdf - mBottomLabel.y) * SCALE; // negative (south)
      mEwAtGrid9 = mEwAtLabel + Math.abs(nsLabel) * tanWing;
      notes.push(`M bottom label: x=${mBottomLabel.x.toFixed(1)}, y=${mBottomLabel.y.toFixed(1)}, ` +
        `NS_label=${(nsLabel/1000).toFixed(3)}m → EW_at_label=${toM(mEwAtLabel)}m → M_ew@grid9=${toM(mEwAtGrid9)} m`);
    } else {
      // Hard fallback: use L_ew (M starts at or just east of L)
      mEwAtGrid9 = lPosMm;
      notes.push(`M bottom label NOT FOUND — using lPosMm=${toM(lPosMm)} m as fallback`);
    }

    wingOriginMm = Math.round(mEwAtGrid9);
    notes.push(`M absolute origin (from bottom label): ${toM(wingOriginMm)} m`);

    // ── Phase 4: Build wing gridlines using already-computed spans ───────────
    let wingCumMm = wingOriginMm;
    grid_lines.push({
      label: wingLetters[0].str.trim(), axis: 'X',
      coordinate_m: toM(wingCumMm),
      start_m: toM(grid19NsCoordMm), end_m: toM(grid10NsCoordMm),
      angle_deg: WING_ANGLE_DEG, section: 'wing', source: 'annotated',
    });
    for (let i = 0; i < relWingSpans.length; i++) {
      wingCumMm += relWingSpans[i];
      grid_lines.push({
        label: wingLetters[i + 1].str.trim(), axis: 'X',
        coordinate_m: toM(wingCumMm),
        start_m: toM(grid19NsCoordMm), end_m: toM(grid10NsCoordMm),
        angle_deg: WING_ANGLE_DEG, section: 'wing',
        source: relWingSources[i] ?? 'annotated',
      });
    }
    wingEndMm = wingCumMm; // Y's absolute EW position
    notes.push(`Y absolute end: ${toM(wingEndMm)} m`);
  }

  // ── 6d. Number gridlines 1–9 (NS left edge) ─────────────────────────────
  // Origin = grid 9 (southernmost, Y = 0); Y increases northward.
  // leftNums is already sorted south→north (grid 9 first).
  const NS_RADIUS = 150;
  if (leftNums.length > 0) {
    let nsCumMm = 0;
    const rectEwEnd = lPosMm > 0 ? toM(lPosMm) : EW_EXTENT;
    grid_lines.push({
      label: leftNums[0].str.trim(), // grid 9
      axis: 'Y', coordinate_m: 0, start_m: 0, end_m: rectEwEnd,
      angle_deg: 0, section: 'rectangular', source: 'annotated',
    });
    for (let i = 0; i < leftNums.length - 1; i++) {
      const south = leftNums[i], north = leftNums[i + 1]; // going northward
      const mx = (south.x + north.x) / 2, my = (south.y + north.y) / 2;
      const hit = nearestDim(dimItems, mx, my, NS_RADIUS);
      let source: 'annotated' | 'scale-fallback' = 'annotated';
      if (hit) {
        nsCumMm += hit.mm;
      } else {
        // y decreases going north in PDF space
        nsCumMm += pdfToMm(south.y - north.y);
        source = 'scale-fallback';
        notes.push(`[FALLBACK] ${south.str.trim()}–${north.str.trim()}`);
      }
      grid_lines.push({
        label: north.str.trim(), axis: 'Y',
        coordinate_m: toM(nsCumMm), start_m: 0, end_m: rectEwEnd,
        angle_deg: 0, section: 'rectangular', source,
      });
    }
  }

  // ── 6e. Number gridlines 10–19 (right edge, wing cross-axis) ────────────
  // Labels are on the right edge of the wing.  Dimension annotations appear
  // to the right of the perimeter wall, following the wing angle — i.e. in a
  // band at x ≥ (label x − 500), restricted to the y-band between each pair.
  //
  // coordinate_m = absolute NS position (grid 9 = 0).  Grid 10 is north of
  // grid 9 (+17.6 m); grid 19 is south of grid 9 (−20.5 m).  Enumeration
  // goes 10→19 (top→bottom in PDF = north→south in real space), so each span
  // is SUBTRACTED from the running coordinate.
  //
  // start_m / end_m = EW extent (X) of each 10–19 line, from M to Y.
  if (rightNums.length > 0) {
    let cwCumMm = grid10NsCoordMm; // absolute NS coord of grid 10 (north of grid 9)
    grid_lines.push({
      label: rightNums[0].str.trim(), // grid 10
      axis: 'Y', coordinate_m: toM(cwCumMm),
      start_m: toM(wingOriginMm), end_m: toM(wingEndMm),
      angle_deg: WING_ANGLE_DEG, section: 'wing', source: 'annotated',
    });
    for (let i = 0; i < rightNums.length - 1; i++) {
      const la = rightNums[i], lb = rightNums[i + 1];
      const hit = nearestRightEdgeDim(dimItems, la, lb, 500);
      let source: 'annotated' | 'scale-fallback' = 'annotated';
      let spanMm: number;
      if (hit) {
        spanMm = hit.mm;
      } else {
        // Fallback: vertical PDF distance × scale (labels are nearly vertical)
        spanMm = pdfToMm(lb.y - la.y);
        source = 'scale-fallback';
        notes.push(`[FALLBACK] CW ${la.str.trim()}–${lb.str.trim()}`);
      }
      cwCumMm -= spanMm; // SUBTRACT: going south = decreasing coordinate
      grid_lines.push({
        label: lb.str.trim(), axis: 'Y',
        coordinate_m: toM(cwCumMm),
        start_m: toM(wingOriginMm), end_m: toM(wingEndMm),
        angle_deg: WING_ANGLE_DEG, section: 'wing', source,
      });
    }
  }

  const annotated = grid_lines.filter(g => g.source === 'annotated').length;
  const fallback  = grid_lines.filter(g => g.source === 'scale-fallback').length;
  notes.push(
    `Total: ${grid_lines.length} gridlines  ` +
    `(${annotated} annotated, ${fallback} scale-fallback)`,
  );

  return {
    grid_lines,
    confidence: grid_lines.length >= 30 && fallback <= 5 ? 'high' : 'low',
    notes,
    bearing_deg:    BEARING_DEG,
    turn_angle_deg: TURN_ANGLE_DEG,
    wing_angle_deg: WING_ANGLE_DEG,
  };
}
