// server/pipeline/pdf-vector-parser.ts
// Extracts text positions and grid data from construction drawing PDFs
// using the pdf.js-extract library. Runs ALONGSIDE the Claude-based pipeline --
// does NOT replace it. The sequential pipeline can choose whichever method
// produces better results.

import { PDFExtract } from 'pdf.js-extract';
import type { PDFExtractText, PDFExtractPage } from 'pdf.js-extract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextItem {
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface DimensionItem {
  text: string;
  value_mm: number;
  x: number;
  y: number;
  page: number;
}

export interface GridBubble {
  label: string;
  x: number;
  y: number;
  page: number;
  family: 'alpha' | 'numeric';
}

export interface DimensionMatch {
  from: string;
  to: string;
  dimension_mm: number;
  dimText: string;
  dimX: number;
  dimY: number;
}

export interface PdfVectorGridResult {
  method: 'pdf_vector';
  confidence: 'high' | 'medium' | 'low';
  alphaGridlines: Array<{ label: string; position_m: number; angle_deg: number; pdf_x: number }>;
  numericGridlines: Array<{ label: string; position_m: number; angle_deg: number; pdf_y: number }>;
  alphaDirection: 'left_to_right' | 'bottom_to_top';
  numericDirection: 'left_to_right' | 'bottom_to_top';
  originLabel: { letter: string; number: string };
  drawingScale: { ratio: string; factor: number; source: string } | null;
  dimensionStrings: Array<{ text: string; value_mm: number; between: { from: string; to: string }; x: number; y: number }>;
  rawTextItems: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Letters commonly excluded from grid labels
const EXCLUDED_LETTERS = new Set(['I', 'O']);

// Tolerance for "consistent position" clustering (fraction of page dimension)
const CLUSTER_TOLERANCE = 0.05;

// Tolerance for matching dimension text to the gap between two grid bubbles
const DIM_MATCH_TOLERANCE = 0.10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const pdfExtract = new PDFExtract();

/**
 * Extract all text items with their page coordinates from a PDF buffer.
 */
export async function extractTextWithPositions(pdfBuffer: Buffer): Promise<TextItem[]> {
  const result = await pdfExtract.extractBuffer(pdfBuffer);
  const items: TextItem[] = [];

  for (const page of result.pages) {
    const pageNum = page.pageInfo.num;
    for (const c of page.content) {
      if (!c.str || !c.str.trim()) continue;
      items.push({
        page: pageNum,
        text: c.str.trim(),
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        fontSize: c.height, // pdf.js-extract reports font size as height
      });
    }
  }

  return items;
}

/**
 * Find dimension-like text strings and their positions.
 * Matches metric (mm) patterns like "6,000", "6000", "8500"
 * and imperial patterns like "19'-8\"", "3'-6\"", "42\"".
 * Returns value in mm + position on page.
 */
export function extractDimensionText(textItems: TextItem[]): DimensionItem[] {
  const dims: DimensionItem[] = [];

  // Metric with comma: "6,000", "12,500" etc.
  const metricCommaRe = /^(\d{1,3}),(\d{3})$/;
  // Metric without comma: 3-6 digit numbers that look like mm dimensions
  const metricPlainRe = /^(\d{3,6})$/;
  // Imperial feet-inches: "19'-8\"", "3'-6\"", "10'-0\""
  const imperialFtInRe = /^(\d+)['']\s*-?\s*(\d+(?:\.\d+)?)["""]?$/;
  // Imperial inches only: "42\"", "36\""
  const imperialInRe = /^(\d+(?:\.\d+)?)["""]$/;
  // Metric with decimal point (metres): "6.0", "7.2" -- only if small values
  const metricMetresRe = /^(\d{1,2}\.\d{1,3})$/;

  for (const item of textItems) {
    const t = item.text.replace(/\s+/g, '');

    // Skip obvious non-dimension text
    if (t.length > 12) continue;
    if (/^[A-Za-z]{2,}/.test(t)) continue; // words
    if (/^[A-Z]-?\d{3,}$/.test(t)) continue; // drawing numbers like A101
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) continue; // dates

    let valueMm: number | null = null;

    const commaMatch = metricCommaRe.exec(t);
    if (commaMatch) {
      valueMm = parseInt(commaMatch[1] + commaMatch[2], 10);
    }

    if (valueMm === null) {
      const plainMatch = metricPlainRe.exec(t);
      if (plainMatch) {
        const v = parseInt(plainMatch[1], 10);
        // Filter out values that are likely page numbers or drawing numbers
        // Valid mm dimensions are typically 100 - 99999
        if (v >= 100 && v <= 99999) {
          valueMm = v;
        }
      }
    }

    if (valueMm === null) {
      const ftInMatch = imperialFtInRe.exec(t);
      if (ftInMatch) {
        const ft = parseFloat(ftInMatch[1]);
        const inches = parseFloat(ftInMatch[2]);
        valueMm = (ft * 304.8) + (inches * 25.4);
      }
    }

    if (valueMm === null) {
      const inMatch = imperialInRe.exec(t);
      if (inMatch) {
        const inches = parseFloat(inMatch[1]);
        if (inches >= 6) { // filter out tiny values
          valueMm = inches * 25.4;
        }
      }
    }

    if (valueMm === null) {
      const metresMatch = metricMetresRe.exec(t);
      if (metresMatch) {
        const m = parseFloat(metresMatch[1]);
        // Only accept if it looks like a reasonable bay dimension (1-50 metres)
        if (m >= 1.0 && m <= 50.0) {
          valueMm = m * 1000;
        }
      }
    }

    if (valueMm !== null && valueMm > 0) {
      dims.push({
        text: item.text,
        value_mm: valueMm,
        x: item.x,
        y: item.y,
        page: item.page,
      });
    }
  }

  return dims;
}

/**
 * Find grid label text (single letters A-Z or numbers 1-99) positioned
 * at the edges of the drawing (top/bottom for alpha, left/right for numeric).
 */
export function findGridBubbles(
  textItems: TextItem[],
  pageWidth: number,
  pageHeight: number,
): GridBubble[] {
  const candidates: GridBubble[] = [];

  // Single uppercase letter (A-Z, excluding I and O)
  const alphaRe = /^([A-Z])$/;
  // Single or double-digit number, possibly with sub-grid (e.g. "1", "12", "2.5")
  const numericRe = /^(\d{1,2}(?:\.\d)?)$/;
  // Also match sub-grid labels like "A.1", "B.2"
  const subgridAlphaRe = /^([A-Z]\.\d)$/;

  for (const item of textItems) {
    const t = item.text.trim();

    const alphaMatch = alphaRe.exec(t);
    if (alphaMatch && !EXCLUDED_LETTERS.has(alphaMatch[1])) {
      candidates.push({
        label: alphaMatch[1],
        x: item.x,
        y: item.y,
        page: item.page,
        family: 'alpha',
      });
      continue;
    }

    const subAlphaMatch = subgridAlphaRe.exec(t);
    if (subAlphaMatch) {
      candidates.push({
        label: subAlphaMatch[1],
        x: item.x,
        y: item.y,
        page: item.page,
        family: 'alpha',
      });
      continue;
    }

    const numMatch = numericRe.exec(t);
    if (numMatch) {
      const val = parseFloat(numMatch[1]);
      if (val >= 1 && val <= 99) {
        candidates.push({
          label: numMatch[1],
          x: item.x,
          y: item.y,
          page: item.page,
          family: 'numeric',
        });
      }
    }
  }

  // Filter to bubbles near the edges of the page
  const edgeThreshold = CLUSTER_TOLERANCE;
  const topEdge = pageHeight * edgeThreshold;
  const bottomEdge = pageHeight * (1 - edgeThreshold);
  const leftEdge = pageWidth * edgeThreshold;
  const rightEdge = pageWidth * (1 - edgeThreshold);

  // Alpha bubbles: should be at top or bottom (consistent Y)
  const alphas = candidates.filter(c => c.family === 'alpha');
  const filteredAlphas = filterByConsistentPosition(
    alphas,
    'y',
    pageHeight,
    topEdge,
    bottomEdge,
  );

  // Numeric bubbles: should be at left or right (consistent X)
  const numerics = candidates.filter(c => c.family === 'numeric');
  const filteredNumerics = filterByConsistentPosition(
    numerics,
    'x',
    pageWidth,
    leftEdge,
    rightEdge,
  );

  return [...filteredAlphas, ...filteredNumerics];
}

/**
 * For each pair of adjacent grid bubbles, find the dimension text
 * that sits between them.
 */
export function matchDimensionsToGridGaps(
  bubbles: GridBubble[],
  dimensions: DimensionItem[],
): DimensionMatch[] {
  const matches: DimensionMatch[] = [];

  // Process alpha and numeric families separately
  for (const family of ['alpha', 'numeric'] as const) {
    const familyBubbles = bubbles
      .filter(b => b.family === family)
      .sort((a, b) => {
        // Alpha sorted by X (horizontal), numeric sorted by Y (vertical)
        return family === 'alpha' ? a.x - b.x : a.y - b.y;
      });

    if (familyBubbles.length < 2) continue;

    for (let i = 0; i < familyBubbles.length - 1; i++) {
      const b1 = familyBubbles[i];
      const b2 = familyBubbles[i + 1];

      // Find dimension text between these two bubbles
      const isHorizontal = family === 'alpha';
      const pos1 = isHorizontal ? b1.x : b1.y;
      const pos2 = isHorizontal ? b2.x : b2.y;
      const minPos = Math.min(pos1, pos2);
      const maxPos = Math.max(pos1, pos2);
      const gap = maxPos - minPos;
      const tolerance = gap * DIM_MATCH_TOLERANCE;

      // Look for dimension text whose primary coordinate falls between the two bubbles
      const samePage = dimensions.filter(d => d.page === b1.page);
      let bestDim: DimensionItem | null = null;
      let bestDist = Infinity;

      for (const dim of samePage) {
        const dimPos = isHorizontal ? dim.x : dim.y;
        const midpoint = (minPos + maxPos) / 2;

        if (dimPos >= minPos - tolerance && dimPos <= maxPos + tolerance) {
          const dist = Math.abs(dimPos - midpoint);
          if (dist < bestDist) {
            bestDist = dist;
            bestDim = dim;
          }
        }
      }

      if (bestDim) {
        matches.push({
          from: b1.label,
          to: b2.label,
          dimension_mm: bestDim.value_mm,
          dimText: bestDim.text,
          dimX: bestDim.x,
          dimY: bestDim.y,
        });
      }
    }
  }

  return matches;
}

/**
 * Find drawing scale text in the title block area (bottom-right of page).
 * Looks for patterns like "1:100", "1:50", "Scale: 1:100", "SCALE 1:200".
 */
export function detectDrawingScale(
  textItems: TextItem[],
  pageWidth: number,
  pageHeight: number,
): { ratio: string; factor: number; source: string } | null {
  // Title block is typically in the bottom-right quadrant
  const titleBlockItems = textItems.filter(item => {
    return item.x > pageWidth * 0.5 && item.y > pageHeight * 0.5;
  });

  // Also search all items -- some drawings place scale elsewhere
  const allItems = [...titleBlockItems, ...textItems];
  const scaleRe = /(?:scale\s*[:=]?\s*)?1\s*:\s*(\d+)/i;
  const ntsRe = /\bN\.?T\.?S\.?\b/i;

  for (const item of allItems) {
    const match = scaleRe.exec(item.text);
    if (match) {
      const denominator = parseInt(match[1], 10);
      if (denominator >= 10 && denominator <= 1000) {
        // factor: 1 drawing mm = factor real metres
        // At 1:100, 1 mm on drawing = 100 mm real = 0.1 m
        const factor = denominator / 1000;
        const source = item.x > pageWidth * 0.5 ? 'title block' : 'drawing annotation';
        return {
          ratio: `1:${denominator}`,
          factor,
          source,
        };
      }
    }
  }

  // Check for NTS (Not To Scale)
  for (const item of allItems) {
    if (ntsRe.test(item.text)) {
      return null;
    }
  }

  return null;
}

/**
 * Main entry point: extract grid data from a PDF buffer using text positions.
 * Returns a PdfVectorGridResult with confidence level.
 */
export async function extractGridFromPdfVector(pdfBuffer: Buffer): Promise<PdfVectorGridResult> {
  const notes: string[] = [];

  // Step 1: Extract all text with positions
  const textItems = await extractTextWithPositions(pdfBuffer);
  if (textItems.length === 0) {
    return emptyResult(0, ['No text items found in PDF']);
  }

  // Use the first page with content for page dimensions
  const pdfResult = await pdfExtract.extractBuffer(pdfBuffer);
  if (pdfResult.pages.length === 0) {
    return emptyResult(textItems.length, ['No pages found in PDF']);
  }

  // Try each page to find grids -- construction drawings may have grid on page 1 or later
  let bestResult: PdfVectorGridResult | null = null;

  for (const page of pdfResult.pages) {
    const pageNum = page.pageInfo.num;
    const pageWidth = page.pageInfo.width;
    const pageHeight = page.pageInfo.height;

    const pageItems = textItems.filter(t => t.page === pageNum);
    if (pageItems.length < 5) continue;

    const result = extractGridFromPage(
      pageItems,
      pageWidth,
      pageHeight,
      pageNum,
      textItems.length,
    );

    if (!bestResult || scoreResult(result) > scoreResult(bestResult)) {
      bestResult = result;
    }
  }

  return bestResult || emptyResult(textItems.length, ['No grid bubbles found on any page']);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract grid from a single page.
 */
function extractGridFromPage(
  pageItems: TextItem[],
  pageWidth: number,
  pageHeight: number,
  pageNum: number,
  totalTextItems: number,
): PdfVectorGridResult {
  const notes: string[] = [];
  notes.push(`Analyzing page ${pageNum} (${pageWidth.toFixed(0)} x ${pageHeight.toFixed(0)} pts)`);

  // Step 2: Find grid bubbles
  const bubbles = findGridBubbles(pageItems, pageWidth, pageHeight);
  const alphaBubbles = bubbles.filter(b => b.family === 'alpha');
  const numericBubbles = bubbles.filter(b => b.family === 'numeric');

  if (alphaBubbles.length === 0 && numericBubbles.length === 0) {
    return emptyResult(totalTextItems, [...notes, 'No grid bubbles found']);
  }

  notes.push(`Found ${alphaBubbles.length} alpha bubbles, ${numericBubbles.length} numeric bubbles`);

  // Step 3: Find dimension text
  const dimensions = extractDimensionText(pageItems);
  notes.push(`Found ${dimensions.length} dimension text items`);

  // Step 4: Match dimensions to grid gaps
  const dimMatches = matchDimensionsToGridGaps(bubbles, dimensions);
  notes.push(`Matched ${dimMatches.length} dimensions to grid gaps`);

  // Step 5: Build gridline positions by accumulation
  const alphaGridlines = buildGridlinePositions(alphaBubbles, dimMatches, 'alpha');
  const numericGridlines = buildGridlinePositions(numericBubbles, dimMatches, 'numeric');

  // Step 6: Detect angled gridlines
  detectAngles(alphaGridlines, alphaBubbles);
  detectAngles(numericGridlines, numericBubbles);

  // Step 7: Determine directions
  const alphaDirection = determineDirection(alphaBubbles, 'alpha');
  const numericDirection = determineDirection(numericBubbles, 'numeric');

  // Step 8: Drawing scale
  const drawingScale = detectDrawingScale(pageItems, pageWidth, pageHeight);
  if (drawingScale) {
    notes.push(`Drawing scale: ${drawingScale.ratio} (${drawingScale.source})`);
  }

  // Step 9: Determine confidence
  const confidence = determineConfidence(alphaGridlines, numericGridlines, dimMatches);

  // Build dimension strings output
  const dimensionStrings = dimMatches.map(m => ({
    text: m.dimText,
    value_mm: m.dimension_mm,
    between: { from: m.from, to: m.to },
    x: m.dimX,
    y: m.dimY,
  }));

  // Determine origin labels
  const firstAlpha = alphaGridlines.length > 0 ? alphaGridlines[0].label : 'A';
  const firstNumeric = numericGridlines.length > 0 ? numericGridlines[0].label : '1';

  return {
    method: 'pdf_vector',
    confidence,
    alphaGridlines: alphaGridlines.map(g => ({
      label: g.label,
      position_m: g.position_m,
      angle_deg: g.angle_deg,
      pdf_x: g.pdf_coord,
    })),
    numericGridlines: numericGridlines.map(g => ({
      label: g.label,
      position_m: g.position_m,
      angle_deg: g.angle_deg,
      pdf_y: g.pdf_coord,
    })),
    alphaDirection,
    numericDirection,
    originLabel: { letter: firstAlpha, number: firstNumeric },
    drawingScale,
    dimensionStrings,
    rawTextItems: totalTextItems,
    notes,
  };
}

interface InternalGridline {
  label: string;
  position_m: number;
  angle_deg: number;
  pdf_coord: number;
}

/**
 * Build accumulated gridline positions from sorted bubbles and matched dimensions.
 */
function buildGridlinePositions(
  bubbles: GridBubble[],
  dimMatches: DimensionMatch[],
  family: 'alpha' | 'numeric',
): InternalGridline[] {
  if (bubbles.length === 0) return [];

  // Sort bubbles by their PDF coordinate
  const sorted = [...bubbles].sort((a, b) => {
    return family === 'alpha' ? a.x - b.x : a.y - b.y;
  });

  // De-duplicate labels (keep the first occurrence)
  const seen = new Set<string>();
  const unique = sorted.filter(b => {
    if (seen.has(b.label)) return false;
    seen.add(b.label);
    return true;
  });

  if (unique.length === 0) return [];

  const gridlines: InternalGridline[] = [];
  let accumulatedMm = 0;

  gridlines.push({
    label: unique[0].label,
    position_m: 0,
    angle_deg: 0,
    pdf_coord: family === 'alpha' ? unique[0].x : unique[0].y,
  });

  for (let i = 0; i < unique.length - 1; i++) {
    const fromLabel = unique[i].label;
    const toLabel = unique[i + 1].label;

    // Find the dimension match for this gap
    const match = dimMatches.find(
      m => (m.from === fromLabel && m.to === toLabel) ||
           (m.from === toLabel && m.to === fromLabel),
    );

    if (match) {
      accumulatedMm += match.dimension_mm;
    }
    // If no dimension match, keep same accumulated position
    // (the gridline will be placed at the same position as the previous one,
    //  which signals incomplete data)

    gridlines.push({
      label: toLabel,
      position_m: accumulatedMm / 1000,
      angle_deg: 0,
      pdf_coord: family === 'alpha' ? unique[i + 1].x : unique[i + 1].y,
    });
  }

  return gridlines;
}

/**
 * Detect if any gridlines in a family are angled (not aligned with the primary axis).
 */
function detectAngles(
  gridlines: InternalGridline[],
  bubbles: GridBubble[],
): void {
  if (gridlines.length < 2 || bubbles.length < 2) return;

  // Check if bubbles form a line that's not horizontal/vertical
  // by looking at variance in the secondary coordinate
  const family = bubbles[0]?.family;
  if (!family) return;

  const primaryCoords = bubbles.map(b => family === 'alpha' ? b.x : b.y);
  const secondaryCoords = bubbles.map(b => family === 'alpha' ? b.y : b.x);

  const secMin = Math.min(...secondaryCoords);
  const secMax = Math.max(...secondaryCoords);
  const secRange = secMax - secMin;

  const priMin = Math.min(...primaryCoords);
  const priMax = Math.max(...primaryCoords);
  const priRange = priMax - priMin;

  // If secondary range is significant relative to primary range, the grid is angled
  if (priRange > 0 && secRange / priRange > 0.05) {
    // Compute angle via linear regression
    const n = bubbles.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const b of bubbles) {
      const px = family === 'alpha' ? b.x : b.y;
      const py = family === 'alpha' ? b.y : b.x;
      sumX += px;
      sumY += py;
      sumXY += px * py;
      sumX2 += px * px;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) > 1e-6) {
      const slope = (n * sumXY - sumX * sumY) / denom;
      const angleDeg = Math.atan(slope) * (180 / Math.PI);

      // Only set if angle is meaningful (> 1 degree)
      if (Math.abs(angleDeg) > 1.0) {
        for (const g of gridlines) {
          g.angle_deg = Math.round(angleDeg * 10) / 10;
        }
      }
    }
  }
}

/**
 * Determine the direction of a grid family based on bubble positions.
 */
function determineDirection(
  bubbles: GridBubble[],
  family: 'alpha' | 'numeric',
): 'left_to_right' | 'bottom_to_top' {
  if (bubbles.length < 2) {
    return family === 'alpha' ? 'left_to_right' : 'bottom_to_top';
  }

  // Sort by natural label order
  const sorted = [...bubbles].sort((a, b) => {
    if (family === 'alpha') {
      return a.label.localeCompare(b.label);
    }
    return parseFloat(a.label) - parseFloat(b.label);
  });

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (family === 'alpha') {
    // If A is to the left of Z, it's left_to_right
    // In PDF coordinates, Y increases downward (pdf.js-extract uses top-left origin)
    // But for grid direction we care about the primary axis
    return first.x <= last.x ? 'left_to_right' : 'bottom_to_top';
  } else {
    // Numeric: if 1 is at lower Y (higher on page in pdf.js-extract coords), it's bottom_to_top
    // pdf.js-extract: Y=0 is top of page, Y increases downward
    return first.y >= last.y ? 'bottom_to_top' : 'left_to_right';
  }
}

/**
 * Determine confidence based on how many gridlines and dimensions were found.
 */
function determineConfidence(
  alphaGridlines: InternalGridline[],
  numericGridlines: InternalGridline[],
  dimMatches: DimensionMatch[],
): 'high' | 'medium' | 'low' {
  const totalGridlines = alphaGridlines.length + numericGridlines.length;
  const hasPositions = alphaGridlines.some(g => g.position_m > 0) ||
                       numericGridlines.some(g => g.position_m > 0);

  if (totalGridlines >= 4 && dimMatches.length >= 3 && hasPositions) {
    return 'high';
  }
  if (totalGridlines >= 2 && dimMatches.length >= 1 && hasPositions) {
    return 'medium';
  }
  return 'low';
}

/**
 * Filter bubbles to those at consistent positions near page edges.
 * For alpha (Y-axis): top or bottom of page.
 * For numeric (X-axis): left or right of page.
 */
function filterByConsistentPosition(
  bubbles: GridBubble[],
  axis: 'x' | 'y',
  pageDimension: number,
  edgeLow: number,
  edgeHigh: number,
): GridBubble[] {
  if (bubbles.length < 2) return bubbles;

  // Cluster bubbles by their position on the given axis
  const positions = bubbles.map(b => axis === 'x' ? b.x : b.y);
  const clusters = clusterPositions(positions, pageDimension * CLUSTER_TOLERANCE);

  // Find the cluster(s) near the edges
  const edgeClusters: number[][] = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const avgPos = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    // Near top/left edge (low values) or bottom/right edge (high values)
    if (avgPos <= edgeLow || avgPos >= edgeHigh) {
      edgeClusters.push(cluster);
    }
  }

  if (edgeClusters.length === 0) {
    // Fallback: use the largest cluster regardless of position
    const largestCluster = clusters.reduce(
      (best, c) => c.length > best.length ? c : best,
      [] as number[],
    );
    if (largestCluster.length < 2) return [];
    const clusterMin = Math.min(...largestCluster);
    const clusterMax = Math.max(...largestCluster);
    return bubbles.filter(b => {
      const pos = axis === 'x' ? b.x : b.y;
      return pos >= clusterMin - pageDimension * CLUSTER_TOLERANCE &&
             pos <= clusterMax + pageDimension * CLUSTER_TOLERANCE;
    });
  }

  // Merge all edge clusters into one set of accepted positions
  const accepted = new Set<number>();
  for (const cluster of edgeClusters) {
    for (const pos of cluster) accepted.add(pos);
  }

  const tolerance = pageDimension * CLUSTER_TOLERANCE;
  return bubbles.filter(b => {
    const pos = axis === 'x' ? b.x : b.y;
    for (const ap of accepted) {
      if (Math.abs(pos - ap) <= tolerance) return true;
    }
    return false;
  });
}

/**
 * Simple 1D clustering: group values that are within `tolerance` of each other.
 */
function clusterPositions(values: number[], tolerance: number): number[][] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const lastCluster = clusters[clusters.length - 1];
    const lastVal = lastCluster[lastCluster.length - 1];
    if (sorted[i] - lastVal <= tolerance) {
      lastCluster.push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }

  return clusters;
}

/**
 * Score a result for comparison (higher = better).
 */
function scoreResult(r: PdfVectorGridResult): number {
  let score = 0;
  score += r.alphaGridlines.length * 10;
  score += r.numericGridlines.length * 10;
  score += r.dimensionStrings.length * 5;
  if (r.confidence === 'high') score += 100;
  if (r.confidence === 'medium') score += 50;
  if (r.drawingScale) score += 20;
  return score;
}

/**
 * Build an empty result with given notes.
 */
function emptyResult(rawTextItems: number, notes: string[]): PdfVectorGridResult {
  return {
    method: 'pdf_vector',
    confidence: 'low',
    alphaGridlines: [],
    numericGridlines: [],
    alphaDirection: 'left_to_right',
    numericDirection: 'bottom_to_top',
    originLabel: { letter: 'A', number: '1' },
    drawingScale: null,
    dimensionStrings: [],
    rawTextItems,
    notes,
  };
}
