/**
 * Gridline PDF Parser -- v5.1 (Fully Generic)
 *
 * Extracts gridline definitions from ANY construction drawing PDF.
 * Zero hardcoded values: no bearings, no scale factors, no band positions, no spacing values.
 *
 * ORIGIN RULE:
 * Origin (0,0,0) is ALWAYS the intersection of the LEFTMOST and LOWEST gridlines
 * on the drawing — the bottom-left corner of the building.
 * All gridline positions are accumulated from this origin using dimension text.
 *
 * Algorithm:
 * 1. Extract all text items from the PDF
 * 2. Identify grid labels (letters A-Z excluding I/O, numbers 1-99, CL variants)
 * 3. Cluster labels into families by position (horizontal rows, vertical columns, diagonals)
 * 4. Detect angles from label geometry via linear regression
 * 5. Find dimension text and match to adjacent label pairs
 * 6. Accumulate positions from dimension values
 * 7. Origin = bottom-left gridline intersection
 * 8. Determine axis, extents, and build output
 * 9. AI verification: output includes data for Claude to verify against PDF image
 * 10. User confirmation: presented to user for final approval
 */

import type { GridlineDefinition } from '../../shared/moorings-grid-constants';

// ---------------------------------------------------------------------------
// Public interfaces (backward-compatible)
// ---------------------------------------------------------------------------

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
  /** GridlineDefinition format output for pipeline consumers */
  gridline_definitions: GridlineDefinition[];
  confidence: 'high' | 'low';
  notes: string[];
  bearing_deg: number;
  turn_angle_deg: number;
  wing_angle_deg: number;
  /** Origin = bottom-left corner gridline intersection */
  origin: {
    alpha_label: string;   // leftmost alpha gridline label (e.g. "A")
    numeric_label: string; // bottommost numeric gridline label (e.g. "9")
    description: string;   // e.g. "Grid A / Grid 9 intersection"
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

/** A label occurrence found in the PDF */
interface LabelHit {
  text: string;
  x: number;
  y: number;
  height: number;
  /** Center X */
  cx: number;
  /** Center Y */
  cy: number;
}

/** A cluster of labels that form a gridline family */
interface LabelFamily {
  labels: LabelHit[];
  /** Angle of the family in degrees (0 = horizontal/vertical, nonzero = diagonal) */
  angle_deg: number;
  /** Whether labels represent letters ('alpha') or numbers ('numeric') */
  type: 'alpha' | 'numeric';
  /** Primary orientation: 'horizontal' if labels run left-right, 'vertical' if top-bottom */
  orientation: 'horizontal' | 'vertical';
  /** Linear regression slope of the label positions (rise/run in PDF coords) */
  slope: number;
  /** Linear regression intercept */
  intercept: number;
}

/** A dimension annotation found between two labels */
interface DimCandidate {
  value_mm: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  str: string;
  height: number;
}

// ---------------------------------------------------------------------------
// Constants (patterns only -- no project-specific values)
// ---------------------------------------------------------------------------

/** Grid label: single uppercase letter A-Z excluding I and O, optionally followed by lowercase */
const LETTER_RE = /^[A-HJ-NP-Z][a-z]?$/;

/** CL-style labels */
const CL_RE = /^CL[a-z]?$/;

/** Numeric grid labels 1-99 */
const NUM_LABEL_RE = /^\d{1,2}$/;

/** Metric dimension: 3-5 digit integer (mm) */
const DIM_METRIC_RE = /^(\d{1,2},)?\d{3,5}$/;

/** Imperial dimension: feet-inches pattern */
const DIM_IMPERIAL_RE = /^(\d+)'[-\s]?(\d+(?:\.\d+)?)"?$/;

/** Bearing annotation: a decimal number that looks like a compass bearing (0-360 range) */
const BEARING_RE = /^(\d{1,3}\.\d{1,4})$/;

/** Minimum text height (PDF units) to consider as meaningful content */
const MIN_TEXT_HEIGHT = 5;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function toM(mm: number): number {
  return parseFloat((mm / 1000).toFixed(4));
}

/**
 * Convert a dimension string to millimetres.
 * Handles: "4710", "4,710", "19'-8\"", etc.
 */
function parseDimensionMm(str: string): number | null {
  const s = str.trim().replace(/\s+/g, '');

  // Imperial: 19'-8", 3'-6"
  const impMatch = s.match(DIM_IMPERIAL_RE);
  if (impMatch) {
    const feet = parseFloat(impMatch[1]);
    const inches = parseFloat(impMatch[2]);
    return Math.round((feet * 12 + inches) * 25.4);
  }

  // Metric with comma: "4,710"
  const noComma = s.replace(/,/g, '');
  if (/^\d{3,5}$/.test(noComma)) {
    return parseInt(noComma, 10);
  }

  return null;
}

/**
 * Linear regression: fit y = slope * x + intercept to a set of (x, y) points.
 * Returns { slope, intercept, r2 }.
 */
function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 1 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    return { slope: 0, intercept: sumY / n, r2: 1 };
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) {
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  return { slope, intercept, r2 };
}

/**
 * Compute the angle in degrees that a set of points' fitted line makes with
 * the horizontal axis. Returns 0 for nearly horizontal lines.
 */
function angleFromSlope(slope: number): number {
  return Math.atan(slope) * (180 / Math.PI);
}

/**
 * Cluster an array of numbers into groups where consecutive values are within `threshold`.
 * Returns array of { center, indices }.
 */
function clusterValues(
  values: number[],
  threshold: number,
): Array<{ center: number; indices: number[] }> {
  if (values.length === 0) return [];

  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const clusters: Array<{ center: number; indices: number[] }> = [];
  let currentCluster = { sum: indexed[0].v, indices: [indexed[0].i] };

  for (let k = 1; k < indexed.length; k++) {
    const currentCenter = currentCluster.sum / currentCluster.indices.length;
    if (Math.abs(indexed[k].v - currentCenter) <= threshold) {
      currentCluster.sum += indexed[k].v;
      currentCluster.indices.push(indexed[k].i);
    } else {
      clusters.push({
        center: currentCluster.sum / currentCluster.indices.length,
        indices: currentCluster.indices,
      });
      currentCluster = { sum: indexed[k].v, indices: [indexed[k].i] };
    }
  }
  clusters.push({
    center: currentCluster.sum / currentCluster.indices.length,
    indices: currentCluster.indices,
  });

  return clusters;
}

// ---------------------------------------------------------------------------
// Step 1: Extract text items
// ---------------------------------------------------------------------------

async function extractTextItems(pdfBuffer: Buffer): Promise<{ items: TextItem[]; pageWidth: number; pageHeight: number } | null> {
  try {
    const { PDFExtract } = await import('pdf.js-extract');
    const extractor = new PDFExtract();
    const data: any = await new Promise((resolve, reject) => {
      extractor.extractBuffer(pdfBuffer, {}, (err: any, res: any) =>
        err ? reject(err) : resolve(res));
    });
    const page = data?.pages?.[0];
    if (!page) return null;
    const items: TextItem[] = (page.content ?? []).filter(
      (i: any) => (i.height ?? 0) >= MIN_TEXT_HEIGHT && (i.str ?? '').trim().length > 0,
    );
    return {
      items,
      pageWidth: page.pageInfo?.width ?? 1000,
      pageHeight: page.pageInfo?.height ?? 800,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2: Find grid labels
// ---------------------------------------------------------------------------

function isGridLabel(str: string): boolean {
  const s = str.trim();
  if (LETTER_RE.test(s)) return true;
  if (CL_RE.test(s)) return true;
  if (NUM_LABEL_RE.test(s)) {
    const n = parseInt(s, 10);
    return n >= 1 && n <= 99;
  }
  return false;
}

function labelType(str: string): 'alpha' | 'numeric' {
  const s = str.trim();
  if (LETTER_RE.test(s) || CL_RE.test(s)) return 'alpha';
  return 'numeric';
}

/**
 * Find all grid label occurrences. Grid labels are text items that:
 * - Match known grid label patterns
 * - Are rendered at a height consistent with grid bubble labels (detect the mode)
 */
function findLabelHits(items: TextItem[]): LabelHit[] {
  // First pass: collect all potential label items
  const candidates: Array<TextItem & { parsed: string }> = [];
  for (const item of items) {
    const s = item.str.trim();
    if (isGridLabel(s)) {
      candidates.push({ ...item, parsed: s });
    }
  }
  if (candidates.length === 0) return [];

  // Determine the dominant font height for grid labels.
  // Grid bubble labels are typically rendered at a consistent, relatively large height.
  // Find the most common height among label candidates (rounded to nearest integer).
  const heightCounts = new Map<number, number>();
  for (const c of candidates) {
    const h = Math.round(c.height);
    heightCounts.set(h, (heightCounts.get(h) ?? 0) + 1);
  }

  // Sort heights by frequency descending, then by height descending (prefer larger labels)
  const sortedHeights = [...heightCounts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Accept the top 1-2 most common heights, provided they are within 30% of each other
  const primaryHeight = sortedHeights[0][0];
  const acceptedHeights = new Set<number>([primaryHeight]);
  for (let i = 1; i < sortedHeights.length; i++) {
    const h = sortedHeights[i][0];
    if (Math.abs(h - primaryHeight) <= primaryHeight * 0.3 && sortedHeights[i][1] >= 3) {
      acceptedHeights.add(h);
    }
  }

  const hits: LabelHit[] = [];
  for (const c of candidates) {
    const h = Math.round(c.height);
    if (!acceptedHeights.has(h)) continue;
    hits.push({
      text: c.parsed,
      x: c.x,
      y: c.y,
      height: c.height,
      cx: c.x + (c.width ?? 0) / 2,
      cy: c.y - (c.height ?? 0) / 2,  // PDF y is baseline; center is above
    });
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Step 3: Group labels into families
// ---------------------------------------------------------------------------

/**
 * Given a set of label hits, group them into families based on:
 * - Spatial clustering (labels at consistent Y = horizontal family, consistent X = vertical)
 * - Label type (alpha vs numeric)
 *
 * A family is a set of labels that form one row or column of gridline bubbles.
 * There may be multiple families per type (e.g., straight + angled alpha families).
 */
function groupIntoFamilies(
  hits: LabelHit[],
  pageWidth: number,
  pageHeight: number,
): LabelFamily[] {
  // Separate by type
  const alphaHits = hits.filter(h => labelType(h.text) === 'alpha');
  const numericHits = hits.filter(h => labelType(h.text) === 'numeric');

  const families: LabelFamily[] = [];

  // For alpha labels: typically arranged horizontally (left to right)
  // There may be pairs (top + bottom of drawing) or single rows
  // Also may be diagonal for angled sections
  if (alphaHits.length > 0) {
    const alphaFamilies = clusterLabelsIntoRows(alphaHits, pageWidth, pageHeight, 'alpha');
    families.push(...alphaFamilies);
  }

  // For numeric labels: typically arranged vertically (top to bottom)
  if (numericHits.length > 0) {
    const numericFamilies = clusterLabelsIntoRows(numericHits, pageWidth, pageHeight, 'numeric');
    families.push(...numericFamilies);
  }

  return families;
}

/**
 * Cluster a set of same-type labels into distinct rows/columns.
 *
 * Strategy:
 * 1. For each unique label text, collect all occurrences
 * 2. Group occurrences by their Y position (for horizontal rows) or X position (for vertical columns)
 * 3. Within each row/column, deduplicate labels and fit a line
 * 4. Determine angle from the fitted line
 */
function clusterLabelsIntoRows(
  hits: LabelHit[],
  pageWidth: number,
  pageHeight: number,
  type: 'alpha' | 'numeric',
): LabelFamily[] {
  if (hits.length < 2) return [];

  // Cluster by Y position to find horizontal rows
  const yThreshold = pageHeight * 0.05; // 5% of page height
  const yClusters = clusterValues(hits.map(h => h.cy), yThreshold);

  // Cluster by X position to find vertical columns
  const xThreshold = pageWidth * 0.05;
  const xClusters = clusterValues(hits.map(h => h.cx), xThreshold);

  const families: LabelFamily[] = [];

  // Try horizontal rows first (labels sharing similar Y)
  for (const yCluster of yClusters) {
    if (yCluster.indices.length < 2) continue;

    const rowHits = yCluster.indices.map(i => hits[i]);
    // Deduplicate by label text within this row, keeping the leftmost occurrence
    const deduped = deduplicateLabels(rowHits, 'horizontal');
    if (deduped.length < 2) continue;

    // Fit a line to determine angle
    const points = deduped.map(h => ({ x: h.cx, y: h.cy }));
    const reg = linearRegression(points);
    const angle = angleFromSlope(reg.slope);

    families.push({
      labels: deduped.sort((a, b) => a.cx - b.cx),
      angle_deg: Math.abs(angle) < 2 ? 0 : angle,
      type,
      orientation: 'horizontal',
      slope: reg.slope,
      intercept: reg.intercept,
    });
  }

  // Try vertical columns (labels sharing similar X)
  for (const xCluster of xClusters) {
    if (xCluster.indices.length < 2) continue;

    const colHits = xCluster.indices.map(i => hits[i]);
    const deduped = deduplicateLabels(colHits, 'vertical');
    if (deduped.length < 2) continue;

    // Check if this column is already represented in a horizontal family
    // (a label can appear in both a horizontal row and vertical column)
    // Only add if the column has unique labels not already in horizontal families
    const existingLabels = new Set<string>();
    for (const f of families) {
      for (const l of f.labels) existingLabels.add(l.text);
    }
    const uniqueInCol = deduped.filter(h => !existingLabels.has(h.text));
    // If most labels in this column are unique, it's a genuine vertical family
    if (uniqueInCol.length < deduped.length * 0.5 && families.length > 0) continue;

    const points = deduped.map(h => ({ x: h.cy, y: h.cx })); // swap for vertical
    const reg = linearRegression(points);
    const angle = angleFromSlope(reg.slope);

    families.push({
      labels: deduped.sort((a, b) => a.cy - b.cy),
      angle_deg: Math.abs(angle) < 2 ? 0 : angle,
      type,
      orientation: 'vertical',
      slope: reg.slope,
      intercept: reg.intercept,
    });
  }

  // If no families found from row/column clustering, try diagonal detection.
  // This handles cases where labels are placed along a diagonal line.
  if (families.length === 0 && hits.length >= 3) {
    const deduped = deduplicateLabels(hits, 'horizontal');
    if (deduped.length >= 2) {
      const points = deduped.map(h => ({ x: h.cx, y: h.cy }));
      const reg = linearRegression(points);
      const angle = angleFromSlope(reg.slope);
      const xSpan = Math.max(...deduped.map(h => h.cx)) - Math.min(...deduped.map(h => h.cx));
      const ySpan = Math.max(...deduped.map(h => h.cy)) - Math.min(...deduped.map(h => h.cy));

      families.push({
        labels: deduped.sort((a, b) => a.cx - b.cx),
        angle_deg: angle,
        type,
        orientation: xSpan >= ySpan ? 'horizontal' : 'vertical',
        slope: reg.slope,
        intercept: reg.intercept,
      });
    }
  }

  // Merge families that share the same labels (e.g., top and bottom rows of the same gridlines)
  return mergeDuplicateFamilies(families);
}

/**
 * Deduplicate labels: if the same label text appears multiple times,
 * keep one representative occurrence.
 */
function deduplicateLabels(hits: LabelHit[], dir: 'horizontal' | 'vertical'): LabelHit[] {
  const byText = new Map<string, LabelHit[]>();
  for (const h of hits) {
    if (!byText.has(h.text)) byText.set(h.text, []);
    byText.get(h.text)!.push(h);
  }
  const result: LabelHit[] = [];
  for (const [, group] of byText) {
    // Pick the one with the smallest coordinate in the primary direction
    if (dir === 'horizontal') {
      group.sort((a, b) => a.cx - b.cx);
    } else {
      group.sort((a, b) => a.cy - b.cy);
    }
    result.push(group[0]);
  }
  return result;
}

/**
 * Merge families that represent the same set of gridlines
 * (e.g., top labels and bottom labels for the same alpha family).
 */
function mergeDuplicateFamilies(families: LabelFamily[]): LabelFamily[] {
  if (families.length <= 1) return families;

  const merged: LabelFamily[] = [];
  const used = new Set<number>();

  for (let i = 0; i < families.length; i++) {
    if (used.has(i)) continue;

    let current = families[i];
    const currentLabels = new Set(current.labels.map(l => l.text));

    for (let j = i + 1; j < families.length; j++) {
      if (used.has(j)) continue;
      const otherLabels = new Set(families[j].labels.map(l => l.text));

      // If families share >50% of labels, merge them
      let overlap = 0;
      for (const l of currentLabels) {
        if (otherLabels.has(l)) overlap++;
      }
      const overlapRatio = overlap / Math.min(currentLabels.size, otherLabels.size);

      if (overlapRatio > 0.5) {
        // Keep the family with more labels, or the one with smaller angle if tied
        if (families[j].labels.length > current.labels.length) {
          current = families[j];
        }
        used.add(j);
      }
    }

    merged.push(current);
    used.add(i);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Step 4: Find dimension text
// ---------------------------------------------------------------------------

function findDimensionCandidates(items: TextItem[]): DimCandidate[] {
  const candidates: DimCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const s = item.str.trim();
    const mm = parseDimensionMm(s);
    if (mm === null) continue;

    // Filter out likely non-dimension values
    // Valid gridline spacing: 100 mm to 50000 mm (0.1 m to 50 m)
    if (mm < 100 || mm > 50000) continue;

    // Deduplicate by position
    const key = `${Math.round(item.x * 10)},${Math.round(item.y * 10)},${s}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push({
      value_mm: mm,
      x: item.x,
      y: item.y,
      cx: item.x + (item.width ?? 0) / 2,
      cy: item.y - (item.height ?? 0) / 2,
      str: s,
      height: item.height,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Step 5: Match dimensions to label gaps
// ---------------------------------------------------------------------------

/**
 * For a pair of adjacent labels, find the dimension text that sits between them.
 * The dimension text midpoint should be spatially between the two labels.
 */
function matchDimensionToGap(
  labelA: LabelHit,
  labelB: LabelHit,
  dims: DimCandidate[],
  orientation: 'horizontal' | 'vertical',
  maxDistFactor: number = 0.15,
): DimCandidate | null {
  // Midpoint between the two labels
  const mx = (labelA.cx + labelB.cx) / 2;
  const my = (labelA.cy + labelB.cy) / 2;

  // Gap size
  const gapSize = orientation === 'horizontal'
    ? Math.abs(labelB.cx - labelA.cx)
    : Math.abs(labelB.cy - labelA.cy);

  // Search radius: proportional to gap size, with a minimum
  const maxDist = Math.max(gapSize * 0.6, 50);

  let best: DimCandidate | null = null;
  let bestDist = Infinity;

  for (const d of dims) {
    // Check that the dimension is roughly between the two labels
    if (orientation === 'horizontal') {
      const minX = Math.min(labelA.cx, labelB.cx) - gapSize * maxDistFactor;
      const maxX = Math.max(labelA.cx, labelB.cx) + gapSize * maxDistFactor;
      if (d.cx < minX || d.cx > maxX) continue;
    } else {
      const minY = Math.min(labelA.cy, labelB.cy) - gapSize * maxDistFactor;
      const maxY = Math.max(labelA.cy, labelB.cy) + gapSize * maxDistFactor;
      if (d.cy < minY || d.cy > maxY) continue;
    }

    const dist = dist2(d.cx, d.cy, mx, my);
    if (dist < maxDist && dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Step 6: Detect bearing annotations
// ---------------------------------------------------------------------------

/**
 * Search for bearing annotations on the drawing (e.g., "166.42" near a compass/angle symbol).
 * A bearing is a decimal number between 0 and 360.
 */
function findBearingAnnotations(items: TextItem[]): number[] {
  const bearings: number[] = [];
  for (const item of items) {
    const s = item.str.trim().replace(/[^0-9.]/g, '');
    if (!BEARING_RE.test(s)) continue;
    const val = parseFloat(s);
    if (val >= 0 && val <= 360 && val !== 0 && val !== 180 && val !== 90 && val !== 270) {
      // Plausible non-cardinal bearing
      bearings.push(val);
    }
  }
  return bearings;
}

// ---------------------------------------------------------------------------
// Step 7: Estimate scale from label positions and matched dimensions
// ---------------------------------------------------------------------------

/**
 * Estimate the PDF-units-to-mm scale factor from successfully matched dimensions.
 * For each matched (labelA, labelB, dimension_mm), compute:
 *   scale = dimension_mm / pdf_distance(labelA, labelB)
 * Return the median scale.
 */
function estimateScale(
  matches: Array<{ a: LabelHit; b: LabelHit; mm: number }>,
  orientation: 'horizontal' | 'vertical',
): number | null {
  if (matches.length === 0) return null;

  const scales: number[] = [];
  for (const m of matches) {
    const pdfDist = orientation === 'horizontal'
      ? Math.abs(m.b.cx - m.a.cx)
      : Math.abs(m.b.cy - m.a.cy);
    if (pdfDist > 1) {
      scales.push(m.mm / pdfDist);
    }
  }

  if (scales.length === 0) return null;
  scales.sort((a, b) => a - b);
  return scales[Math.floor(scales.length / 2)]; // median
}

// ---------------------------------------------------------------------------
// Step 8: Build gridlines from a single family
// ---------------------------------------------------------------------------

interface FamilyBuildResult {
  gridlines: Array<{
    label: string;
    axis: 'X' | 'Y';
    coordinate_m: number;
    angle_deg: number;
    source: 'annotated' | 'scale-fallback';
  }>;
  totalExtent_mm: number;
}

function buildFamilyGridlines(
  family: LabelFamily,
  dims: DimCandidate[],
  allFamilyScales: Map<LabelFamily, number>,
  notes: string[],
): FamilyBuildResult {
  const labels = [...family.labels];
  const orientation = family.orientation;

  // Sort labels so that the BOTTOM-LEFT corner of the drawing is first.
  // This ensures origin (0,0,0) is always at the bottom-left gridline intersection.
  //
  // For horizontal families (alpha/letters): sort left→right (ascending X)
  //   The leftmost label = position 0 (EW origin)
  //
  // For vertical families (numeric/numbers): sort bottom→top (DESCENDING Y in PDF space,
  //   because PDF Y=0 is TOP of page, so bottom of page = highest Y)
  //   The bottommost label = position 0 (NS origin)
  if (orientation === 'horizontal') {
    labels.sort((a, b) => a.cx - b.cx);     // left to right
  } else {
    labels.sort((a, b) => b.cy - a.cy);     // bottom to top (highest PDF Y = bottom of page = first)
  }

  // Match dimensions to each consecutive pair
  const matchedPairs: Array<{
    a: LabelHit;
    b: LabelHit;
    dim: DimCandidate | null;
  }> = [];

  for (let i = 0; i < labels.length - 1; i++) {
    const dim = matchDimensionToGap(labels[i], labels[i + 1], dims, orientation);
    matchedPairs.push({ a: labels[i], b: labels[i + 1], dim });
  }

  // Compute scale from successfully matched pairs
  const successfulMatches = matchedPairs
    .filter(p => p.dim !== null)
    .map(p => ({ a: p.a, b: p.b, mm: p.dim!.value_mm }));

  let scale = estimateScale(successfulMatches, orientation);

  // If we couldn't compute a scale from this family, try using scales from other families
  if (scale === null) {
    for (const [, s] of allFamilyScales) {
      if (s > 0) { scale = s; break; }
    }
  }

  // Accumulate positions
  const gridlines: FamilyBuildResult['gridlines'] = [];
  let cumMm = 0;

  // Determine axis from label type and orientation
  // Alpha labels running horizontally = axis X (NS-running lines with EW coordinate)
  // Numeric labels running vertically = axis Y (EW-running lines with NS coordinate)
  // This can be reversed in some drawings; detect by label type
  const axis: 'X' | 'Y' = family.type === 'alpha' ? 'X' : 'Y';

  gridlines.push({
    label: labels[0].text,
    axis,
    coordinate_m: 0,
    angle_deg: family.angle_deg,
    source: 'annotated',
  });

  for (let i = 0; i < matchedPairs.length; i++) {
    const pair = matchedPairs[i];
    let source: 'annotated' | 'scale-fallback' = 'annotated';

    if (pair.dim) {
      cumMm += pair.dim.value_mm;
    } else if (scale !== null) {
      // Fallback: use scale to estimate
      const pdfDist = orientation === 'horizontal'
        ? Math.abs(pair.b.cx - pair.a.cx)
        : Math.abs(pair.b.cy - pair.a.cy);
      cumMm += Math.round(pdfDist * scale);
      source = 'scale-fallback';
      notes.push(`[FALLBACK] ${pair.a.text}-${pair.b.text}: no dimension found, used scale`);
    } else {
      // No scale available at all -- skip
      source = 'scale-fallback';
      notes.push(`[FALLBACK] ${pair.a.text}-${pair.b.text}: no dimension or scale available`);
    }

    gridlines.push({
      label: labels[i + 1].text,
      axis,
      coordinate_m: toM(cumMm),
      angle_deg: family.angle_deg,
      source,
    });
  }

  // Store the computed scale for other families to use
  if (scale !== null) {
    allFamilyScales.set(family, scale);
  }

  return { gridlines, totalExtent_mm: cumMm };
}

// ---------------------------------------------------------------------------
// Step 9: Determine extents and assemble final output
// ---------------------------------------------------------------------------

/**
 * Determine whether a family is "straight" (angle near 0) or "angled" (wing/transition).
 */
function classifySection(angleDeg: number): 'rectangular' | 'wing' {
  return Math.abs(angleDeg) < 2 ? 'rectangular' : 'wing';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function parseGridlinesFromPdf(
  pdfBuffer: Buffer,
): Promise<GridlineParsedResult | null> {
  const notes: string[] = [];

  // ---- Step 1: Extract text items ----
  const extracted = await extractTextItems(pdfBuffer);
  if (!extracted) {
    return null;
  }
  const { items, pageWidth, pageHeight } = extracted;
  notes.push(`PDF items: ${items.length}, page: ${pageWidth.toFixed(0)} x ${pageHeight.toFixed(0)}`);

  // ---- Step 2: Find grid labels ----
  const labelHits = findLabelHits(items);
  notes.push(`Grid label hits: ${labelHits.length}`);
  if (labelHits.length < 2) {
    notes.push('Too few grid labels found');
    return {
      grid_lines: [],
      gridline_definitions: [],
      confidence: 'low',
      notes,
      bearing_deg: 0,
      turn_angle_deg: 0,
      wing_angle_deg: 0,
      origin: { alpha_label: '?', numeric_label: '?', description: 'Not determined' },
    };
  }

  // ---- Step 3: Group into families ----
  const families = groupIntoFamilies(labelHits, pageWidth, pageHeight);
  notes.push(`Label families: ${families.length}`);
  for (const f of families) {
    notes.push(
      `  Family: ${f.type} ${f.orientation}, ${f.labels.length} labels ` +
      `[${f.labels.map(l => l.text).join(', ')}], angle=${f.angle_deg.toFixed(2)}`,
    );
  }

  if (families.length === 0) {
    notes.push('No label families detected');
    return {
      grid_lines: [],
      gridline_definitions: [],
      confidence: 'low',
      notes,
      bearing_deg: 0,
      turn_angle_deg: 0,
      wing_angle_deg: 0,
      origin: { alpha_label: '?', numeric_label: '?', description: 'Not determined' },
    };
  }

  // ---- Step 4: Find dimension candidates ----
  const dimCandidates = findDimensionCandidates(items);
  notes.push(`Dimension candidates: ${dimCandidates.length}`);

  // ---- Step 5: Detect bearing annotations ----
  const bearings = findBearingAnnotations(items);
  let bearingDeg = 0;
  let turnAngleDeg = 0;
  let wingAngleDeg = 0;

  if (bearings.length > 0) {
    // Use the most common bearing value
    const bearingCounts = new Map<number, number>();
    for (const b of bearings) {
      const key = parseFloat(b.toFixed(2));
      bearingCounts.set(key, (bearingCounts.get(key) ?? 0) + 1);
    }
    const sortedBearings = [...bearingCounts.entries()].sort((a, b) => b[1] - a[1]);
    bearingDeg = sortedBearings[0][0];
    turnAngleDeg = Math.abs(180 - bearingDeg);

    // Count how many times the bearing appears (each occurrence may represent a turn)
    const turnCount = sortedBearings[0][1];
    wingAngleDeg = turnCount * turnAngleDeg;
    notes.push(
      `Bearing: ${bearingDeg} found ${turnCount} time(s), ` +
      `turn=${turnAngleDeg.toFixed(2)}, wing=${wingAngleDeg.toFixed(2)}`,
    );
  } else {
    // Derive angles from family geometry differences
    const familyAngles = families.map(f => Math.abs(f.angle_deg)).filter(a => a > 2);
    if (familyAngles.length > 0) {
      wingAngleDeg = Math.max(...familyAngles);
      turnAngleDeg = wingAngleDeg / 2;
      bearingDeg = 180 - turnAngleDeg;
      notes.push(
        `No bearing annotation; derived from geometry: wing=${wingAngleDeg.toFixed(2)}, ` +
        `turn=${turnAngleDeg.toFixed(2)}, bearing=${bearingDeg.toFixed(2)}`,
      );
    } else {
      notes.push('No bearing annotations or angled families detected');
    }
  }

  // ---- Step 6: Build gridlines for each family ----
  const allFamilyScales = new Map<LabelFamily, number>();
  const familyResults: Array<{
    family: LabelFamily;
    result: FamilyBuildResult;
  }> = [];

  // Process straight families first (more reliable for scale computation)
  const sortedFamilies = [...families].sort((a, b) => {
    const aAng = Math.abs(a.angle_deg);
    const bAng = Math.abs(b.angle_deg);
    return aAng - bAng; // straight first
  });

  for (const family of sortedFamilies) {
    // Override family angle with bearing-derived angle if applicable
    if (wingAngleDeg > 0 && Math.abs(family.angle_deg) > 2) {
      // Determine if this is a transition family (half angle) or full wing
      const halfAngle = turnAngleDeg;
      const fullAngle = wingAngleDeg;

      // Use the derived angle closest to the detected family angle
      const diffHalf = Math.abs(Math.abs(family.angle_deg) - halfAngle);
      const diffFull = Math.abs(Math.abs(family.angle_deg) - fullAngle);

      if (diffHalf < diffFull) {
        family.angle_deg = family.angle_deg > 0 ? halfAngle : -halfAngle;
      } else {
        family.angle_deg = family.angle_deg > 0 ? fullAngle : -fullAngle;
      }
    }

    const result = buildFamilyGridlines(family, dimCandidates, allFamilyScales, notes);
    familyResults.push({ family, result });
  }

  // ---- Step 7: Compute extents ----
  // For each axis, the extent is the range of the perpendicular axis
  // Alpha (axis=X) gridlines: their start_m/end_m = range of numeric (axis=Y) coordinates
  // Numeric (axis=Y) gridlines: their start_m/end_m = range of alpha (axis=X) coordinates

  // Collect all coordinates by axis and section
  const xCoordsBySection = new Map<string, { min: number; max: number }>();
  const yCoordsBySection = new Map<string, { min: number; max: number }>();

  for (const { family, result } of familyResults) {
    const section = classifySection(family.angle_deg);
    const sectionKey = `${section}_${family.angle_deg.toFixed(1)}`;

    for (const g of result.gridlines) {
      const map = g.axis === 'X' ? xCoordsBySection : yCoordsBySection;
      if (!map.has(sectionKey)) {
        map.set(sectionKey, { min: g.coordinate_m, max: g.coordinate_m });
      } else {
        const range = map.get(sectionKey)!;
        range.min = Math.min(range.min, g.coordinate_m);
        range.max = Math.max(range.max, g.coordinate_m);
      }
    }
  }

  // Compute overall extents per axis
  let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
  for (const [, range] of xCoordsBySection) {
    xMin = Math.min(xMin, range.min);
    xMax = Math.max(xMax, range.max);
  }
  for (const [, range] of yCoordsBySection) {
    yMin = Math.min(yMin, range.min);
    yMax = Math.max(yMax, range.max);
  }

  // ---- Step 8: Assemble output ----
  const grid_lines: ParsedGridLine[] = [];
  const gridline_definitions: GridlineDefinition[] = [];

  for (const { family, result } of familyResults) {
    const section = classifySection(family.angle_deg);

    // Determine extents for this family's gridlines
    // alpha (X) gridlines span the perpendicular numeric (Y) range
    // numeric (Y) gridlines span the perpendicular alpha (X) range
    // Try to match extents from families at the same angle
    let startM: number;
    let endM: number;

    if (family.type === 'alpha') {
      // X-axis gridlines: extent is the Y-axis range
      // Find numeric families at the same angle
      const matchingNumeric = familyResults.filter(
        fr => fr.family.type === 'numeric' &&
              Math.abs(fr.family.angle_deg - family.angle_deg) < 3
      );
      if (matchingNumeric.length > 0) {
        const coords = matchingNumeric.flatMap(fr => fr.result.gridlines.map(g => g.coordinate_m));
        startM = Math.min(...coords);
        endM = Math.max(...coords);
      } else {
        startM = yMin;
        endM = yMax;
      }
    } else {
      // Y-axis gridlines: extent is the X-axis range
      const matchingAlpha = familyResults.filter(
        fr => fr.family.type === 'alpha' &&
              Math.abs(fr.family.angle_deg - family.angle_deg) < 3
      );
      if (matchingAlpha.length > 0) {
        const coords = matchingAlpha.flatMap(fr => fr.result.gridlines.map(g => g.coordinate_m));
        startM = Math.min(...coords);
        endM = Math.max(...coords);
      } else {
        startM = xMin;
        endM = xMax;
      }
    }

    for (const g of result.gridlines) {
      grid_lines.push({
        label: g.label,
        axis: g.axis,
        coordinate_m: g.coordinate_m,
        start_m: startM,
        end_m: endM,
        angle_deg: g.angle_deg,
        section,
        source: g.source,
      });

      gridline_definitions.push({
        label: g.label,
        axis: g.axis,
        coord: g.coordinate_m,
        start_m: startM,
        end_m: endM,
        angle_deg: g.angle_deg,
      });
    }
  }

  // ---- Summary ----
  const annotated = grid_lines.filter(g => g.source === 'annotated').length;
  const fallback = grid_lines.filter(g => g.source === 'scale-fallback').length;
  notes.push(
    `Total: ${grid_lines.length} gridlines ` +
    `(${annotated} annotated, ${fallback} scale-fallback)`,
  );

  // Confidence: high if we found a reasonable number of gridlines with mostly annotated sources
  const confidence: 'high' | 'low' =
    grid_lines.length >= 4 && fallback <= grid_lines.length * 0.3 ? 'high' : 'low';

  // Determine origin — the bottom-left corner gridline intersection.
  // This is the FIRST label in each sorted family (position 0).
  const alphaOrigin = grid_lines.find(g => g.axis === 'X' && g.coordinate_m === 0);
  const numericOrigin = grid_lines.find(g => g.axis === 'Y' && g.coordinate_m === 0);
  const origin = {
    alpha_label: alphaOrigin?.label || grid_lines.find(g => g.axis === 'X')?.label || '?',
    numeric_label: numericOrigin?.label || grid_lines.find(g => g.axis === 'Y')?.label || '?',
    description: '',
  };
  origin.description = `Grid ${origin.alpha_label} / Grid ${origin.numeric_label} intersection (bottom-left corner)`;
  notes.push(`Origin: ${origin.description}`);

  return {
    grid_lines,
    gridline_definitions,
    confidence,
    notes,
    bearing_deg: bearingDeg,
    turn_angle_deg: turnAngleDeg,
    wing_angle_deg: wingAngleDeg,
    origin,
  };
}
