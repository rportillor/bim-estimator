// server/services/raster-grid-extractor.ts
// ═══════════════════════════════════════════════════════════════════════════════
// RASTER GRID LINE EXTRACTOR — v1.1 §3–§5 (IMAGE / PDF_RASTER path)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Extracts structural grid geometry from raster images and scanned PDF drawings.
// Confidence range: IMAGE 0.30–0.60, PDF_RASTER 0.40–0.70 (v1.1 §3).
//
// Pipeline (16 steps):
//   1.  Input normalization   — PDF_RASTER→pdf2pic PNG buffer; IMAGE direct
//   2.  Preprocessing         — sharp grayscale, normalize, resize ≤MAX_DIM
//   3.  Edge detection        — Sobel 3×3 gradient operator → binary edge map
//   4.  Hough line transform  — (ρ,θ) accumulator at 0.5° resolution → peaks
//   5.  Segment extraction    — walk edge pixels along each Hough line → runs
//   6.  Canonical angles      — fold all angles into [0°, 180°)
//   7.  DBSCAN clustering     — group segments by orientation family
//   8.  Offset clustering     — perpendicular projection within each family
//   9.  Segment merging       — gap-tolerant collinear join
//  10.  Axis consolidation    — endpoint extension, raster confidence scoring
//  11.  Hough circle detect   — radius range [markerAreaMin, markerAreaMax]
//  12.  Tesseract OCR         — word-level bboxes for grid label candidates
//  13.  Label normalization   — grid-label-engine scoring + sequence analysis
//  14.  Intersection nodes    — cross-family line-line intersections
//  15.  Coordinate transform  — pixel → model-space (DPI-aware scale)
//  16.  Package + register    — ExtractorResult with temp-index FK refs
//
// Design intent (no-default principle):
//   - Low DPI (< MIN_DPI_WARN) generates RFI warning, NOT phantom grid lines
//   - Insufficient peaks → FAILED run + RFI, never synthetic grid
//   - Axes below reviewThreshold remain unassigned (NEEDS_REVIEW)
//   - All confidence values are lower than DXF path (raster is inherently noisier)
//
// Limitations:
//   - Skewed drawings reduce Hough peak sharpness → lower confidence scores
//   - Dense hatching creates false-positive edge pixels → handled via minVotes
//   - Embedded watermarks / title-block lines may be misclassified as grid
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification
// ═══════════════════════════════════════════════════════════════════════════════

import Tesseract from 'tesseract.js';
import {
  registerGridExtractor,
  type GridExtractor,
  type ExtractorResult,
  type InputClassification,
  type DEFAULT_DETECTION_PARAMS,
} from './grid-detection-orchestrator';
import type {
  InsertGridComponent,
  InsertGridFamily,
  InsertGridAxis,
  InsertGridNode,
  InsertGridNodeAxis,
  InsertGridCoordinateTransform,
} from '@shared/schema';
import {
  runLabelEngine,
  convertToInsertTypes,
  type RawCircleShape,
  type RawTextEntity,
  type AxisGeometry,
  type ContentBounds,
  type LabelEngineParams,
} from './grid-label-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Maximum image dimension after resize. Larger images are downscaled. */
const MAX_DIM = 1600;

/** Assume this DPI when no metadata is available from pdf2pic */
const DEFAULT_ASSUMED_DPI = 150;

/** Warn when detected DPI is below this — likely a thumbnail, not a drawing */
const MIN_DPI_WARN = 72;

/** Hough θ step in degrees */
const HOUGH_THETA_STEP = 0.5;

/** Number of θ bins covering [0°, 180°) */
const HOUGH_THETA_BINS = Math.round(180 / HOUGH_THETA_STEP); // 360

/** Raster confidence base — lower than DXF (0.60) to reflect noise */
const RASTER_CONF_BASE = 0.45;

/** Maximum gap (pixels) between edge pixels on the same Hough line */
const SEGMENT_GAP_PX = 8;

/** Maximum confidence achievable on raster path (v1.1 §3 cap) */
const RASTER_MAX_CONF = 0.70;

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Vec2 { x: number; y: number; }
interface BBox  { minX: number; minY: number; maxX: number; maxY: number; }

interface ProcessedImage {
  pixels: Uint8Array;   // Grayscale, one byte per pixel, row-major
  edges:  Uint8Array;   // Binary edge map (0 or 255)
  width:  number;
  height: number;
  scale:  number;       // Resize ratio applied (≤ 1.0)
  dpi:    number;       // Effective DPI used for coordinate transform
}

interface RawSegment {
  p0:        Vec2;
  p1:        Vec2;
  length:    number;
  angleDeg:  number;   // Canonical [0, 180)
}

interface HoughPeak {
  rho:      number;    // pixels, can be negative
  thetaDeg: number;    // degrees [0, 180)
  votes:    number;
}

interface AngleCluster {
  medianAngleDeg: number;
  segments:       RawSegment[];
}

interface OffsetGroup {
  offsetD:  number;    // Perpendicular offset from origin (pixels)
  segments: RawSegment[];
}

interface MergedAxis {
  p0:          Vec2;
  p1:          Vec2;
  offsetD:     number;
  familyIdx:   number;
  segmentCount: number;
  totalLength: number;
  confidence:  number;
  extentMinT:  number;
  extentMaxT:  number;
}

interface CircleCandidate {
  cx:        number;   // pixels
  cy:        number;   // pixels
  radius:    number;   // pixels
  votes:     number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — INPUT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize input to a PNG image Buffer.
 *
 * PDF_RASTER → pdf2pic (fromBuffer, page 1 or specified page)
 * IMAGE      → return buffer unchanged (sharp accepts PNG/JPG/TIF natively)
 *
 * Returns null if conversion fails. Caller must treat null as a hard failure.
 */
async function normalizeInputToImageBuffer(
  buffer:         Buffer,
  classification: InputClassification,
  pageNo:         number,
  warnings:       string[],
): Promise<Buffer | null> {
  if (classification.inputType === 'IMAGE') {
    return buffer;
  }

  // PDF_RASTER path: convert page to PNG via pdf2pic
  try {
    const { fromBuffer } = await import('pdf2pic') as any;
    const convert = fromBuffer(buffer, {
      density:  DEFAULT_ASSUMED_DPI,
      format:   'png',
      width:    MAX_DIM,
      height:   Math.round(MAX_DIM * 1.5),
    });

    const result = await convert(pageNo, { responseType: 'base64' });
    if (!result?.base64) {
      warnings.push(`pdf2pic returned no base64 data for page ${pageNo}`);
      return null;
    }
    return Buffer.from(result.base64, 'base64');
  } catch (err) {
    warnings.push(`pdf2pic conversion failed: ${(err as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — PREPROCESSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load image buffer through sharp, return grayscale raw pixels + edge map.
 * Resizes to fit within MAX_DIM×MAX_DIM (preserving aspect ratio).
 */
async function preprocessImage(
  imageBuffer: Buffer,
  warnings:    string[],
): Promise<ProcessedImage | null> {
  let sharp: typeof import('sharp');
  try {
    sharp = (await import('sharp')).default as typeof import('sharp');
  } catch {
    warnings.push('sharp is not available — cannot preprocess raster image');
    return null;
  }

  try {
    // ── Metadata probe ──
    const meta = await sharp(imageBuffer).metadata();
    const origW = meta.width  ?? 0;
    const origH = meta.height ?? 0;
    if (origW < 10 || origH < 10) {
      warnings.push(`Image dimensions too small: ${origW}×${origH}px`);
      return null;
    }

    // Effective DPI from metadata (may be 0/undefined for scans without metadata)
    const metaDpi = meta.density ?? 0;
    const dpi     = metaDpi >= MIN_DPI_WARN ? metaDpi : DEFAULT_ASSUMED_DPI;
    if (metaDpi > 0 && metaDpi < MIN_DPI_WARN) {
      warnings.push(
        `Low DPI detected (${metaDpi}). Grid detection accuracy will be reduced. ` +
        `RFI recommended: request higher-resolution scan (≥ ${MIN_DPI_WARN} DPI).`
      );
    }

    // ── Resize to MAX_DIM ──
    const scale = Math.min(1.0, MAX_DIM / Math.max(origW, origH));
    const W = Math.round(origW * scale);
    const H = Math.round(origH * scale);

    const pixels = await sharp(imageBuffer)
      .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
      .grayscale()
      .normalise()
      .raw()
      .toBuffer();

    const edges = sobelEdgeDetect(pixels, W, H);

    return { pixels, edges, width: W, height: H, scale, dpi };
  } catch (err) {
    warnings.push(`Image preprocessing failed: ${(err as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — SOBEL EDGE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** Sobel 3×3 operator → binary edge map (0 or 255). */
function sobelEdgeDetect(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const edges = new Uint8Array(width * height);
  let maxMag = 0;
  const magnitudes = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // 3×3 neighbourhood (grayscale, 1 channel)
      const tl = pixels[(y-1)*width + (x-1)];
      const tc = pixels[(y-1)*width +  x     ];
      const tr = pixels[(y-1)*width + (x+1)];
      const ml = pixels[  y  *width + (x-1)];
      const mr = pixels[  y  *width + (x+1)];
      const bl = pixels[(y+1)*width + (x-1)];
      const bc = pixels[(y+1)*width +  x     ];
      const br = pixels[(y+1)*width + (x+1)];

      const gx = -tl + tr - 2*ml + 2*mr - bl + br;
      const gy = -tl - 2*tc - tr + bl + 2*bc + br;
      const mag = Math.sqrt(gx*gx + gy*gy);
      magnitudes[y*width + x] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }

  // Threshold at 20% of max magnitude (typical Sobel threshold for line drawings)
  const threshold = maxMag * 0.20;
  for (let i = 0; i < magnitudes.length; i++) {
    edges[i] = magnitudes[i] > threshold ? 255 : 0;
  }

  return edges;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — HOUGH LINE TRANSFORM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Standard Hough line transform.
 * Returns peaks in (ρ, θ) space above the vote threshold.
 *
 * θ range: [0°, 180°) at HOUGH_THETA_STEP resolution
 * ρ range: [-diag, +diag] at 1px resolution
 */
function houghLines(
  edges:      Uint8Array,
  width:      number,
  height:     number,
  minVotes:   number,
): HoughPeak[] {
  const diag   = Math.ceil(Math.sqrt(width*width + height*height));
  const rhoOffset = diag;         // shift so ρ_idx = rho + diag ≥ 0
  const rhoCount  = 2 * diag + 1;

  // Pre-compute sin/cos for each θ bin
  const cosT = new Float64Array(HOUGH_THETA_BINS);
  const sinT = new Float64Array(HOUGH_THETA_BINS);
  for (let ti = 0; ti < HOUGH_THETA_BINS; ti++) {
    const tRad = (ti * HOUGH_THETA_STEP * Math.PI) / 180;
    cosT[ti] = Math.cos(tRad);
    sinT[ti] = Math.sin(tRad);
  }

  // Accumulator: rhoCount rows × HOUGH_THETA_BINS columns (row-major)
  const acc = new Int32Array(rhoCount * HOUGH_THETA_BINS);

  // Vote
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edges[y * width + x]) continue;
      for (let ti = 0; ti < HOUGH_THETA_BINS; ti++) {
        const rho    = Math.round(x * cosT[ti] + y * sinT[ti]);
        const rhoIdx = rho + rhoOffset;
        if (rhoIdx >= 0 && rhoIdx < rhoCount) {
          acc[rhoIdx * HOUGH_THETA_BINS + ti]++;
        }
      }
    }
  }

  // Non-maximum suppression (5×5 window in ρ-θ space) + threshold
  const peaks: HoughPeak[] = [];
  const WINDOW = 2;
  for (let ri = WINDOW; ri < rhoCount - WINDOW; ri++) {
    for (let ti = WINDOW; ti < HOUGH_THETA_BINS - WINDOW; ti++) {
      const v = acc[ri * HOUGH_THETA_BINS + ti];
      if (v < minVotes) continue;

      // Local maximum check
      let isMax = true;
      outerLoop:
      for (let dr = -WINDOW; dr <= WINDOW; dr++) {
        for (let dt = -WINDOW; dt <= WINDOW; dt++) {
          if (dr === 0 && dt === 0) continue;
          if (acc[(ri+dr) * HOUGH_THETA_BINS + (ti+dt)] > v) {
            isMax = false;
            break outerLoop;
          }
        }
      }

      if (isMax) {
        peaks.push({
          rho:      ri - rhoOffset,
          thetaDeg: ti * HOUGH_THETA_STEP,
          votes:    v,
        });
      }
    }
  }

  // Sort by descending votes
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — SEGMENT EXTRACTION FROM HOUGH PEAKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Walk along each Hough line and extract contiguous edge-pixel runs as segments.
 * A "run" is a sequence of edge pixels on the line with gaps ≤ SEGMENT_GAP_PX.
 */
function extractSegmentsFromHough(
  peaks:  HoughPeak[],
  edges:  Uint8Array,
  width:  number,
  height: number,
): RawSegment[] {
  const diag    = Math.ceil(Math.sqrt(width*width + height*height));
  const segments: RawSegment[] = [];

  for (const peak of peaks) {
    const tRad   = (peak.thetaDeg * Math.PI) / 180;
    const cosT   = Math.cos(tRad);
    const sinT   = Math.sin(tRad);

    // Foot of perpendicular from origin to this line
    const fx = peak.rho * cosT;
    const fy = peak.rho * sinT;

    // Direction vector along the line (perpendicular to normal)
    const dx = -sinT;
    const dy =  cosT;

    // Walk from -diag to +diag along the line
    let runStart: Vec2 | null = null;
    let runEnd:   Vec2 | null = null;
    let gapCount = 0;

    for (let t = -diag; t <= diag; t++) {
      const px = Math.round(fx + t * dx);
      const py = Math.round(fy + t * dy);

      if (px < 0 || px >= width || py < 0 || py >= height) {
        if (runStart && runEnd) {
          // Flush segment on bounds exit
          const len = Math.hypot(runEnd.x - runStart.x, runEnd.y - runStart.y);
          if (len > 5) {
            const angleDeg = canonicalAngle(Math.atan2(dy, dx) * 180 / Math.PI);
            segments.push({ p0: runStart, p1: runEnd, length: len, angleDeg });
          }
          runStart = null; runEnd = null; gapCount = 0;
        }
        continue;
      }

      const isEdge = edges[py * width + px] > 0;

      if (isEdge) {
        if (!runStart) runStart = { x: px, y: py };
        runEnd   = { x: px, y: py };
        gapCount = 0;
      } else {
        if (runStart) {
          gapCount++;
          if (gapCount > SEGMENT_GAP_PX) {
            // End of run
            const len = Math.hypot(runEnd!.x - runStart.x, runEnd!.y - runStart.y);
            if (len > 5) {
              const angleDeg = canonicalAngle(Math.atan2(dy, dx) * 180 / Math.PI);
              segments.push({ p0: runStart, p1: runEnd!, length: len, angleDeg });
            }
            runStart = null; runEnd = null; gapCount = 0;
          }
        }
      }
    }

    // Flush any open run
    if (runStart && runEnd) {
      const len = Math.hypot(runEnd.x - runStart.x, runEnd.y - runStart.y);
      if (len > 5) {
        const angleDeg = canonicalAngle(Math.atan2(dy, dx) * 180 / Math.PI);
        segments.push({ p0: runStart, p1: runEnd, length: len, angleDeg });
      }
    }
  }

  return segments;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — CANONICAL ANGLE
// ═══════════════════════════════════════════════════════════════════════════════

/** Fold any angle (degrees) into canonical [0°, 180°). */
function canonicalAngle(deg: number): number {
  let a = deg % 180;
  if (a < 0) a += 180;
  return a;
}

/** Circular mean of angles in [0°, 180°) — handles wraparound at 0/180. */
function circularMean(angles: number[]): number {
  let sx = 0, sy = 0;
  for (const a of angles) {
    const r = (a * 2 * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const meanR = Math.atan2(sy, sx);
  let deg = (meanR * 180) / Math.PI / 2;
  if (deg < 0) deg += 180;
  return deg;
}

/** Angular distance between two canonical angles (both in [0°, 180°)). */
function angleDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 180 - d);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — DBSCAN ANGLE CLUSTERING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DBSCAN clustering on canonical angles.
 * Groups segments that share orientation within eps degrees.
 */
function dbscanAngleClusters(
  segments:   RawSegment[],
  eps:        number,
  minSupport: number,
): AngleCluster[] {
  const n       = segments.length;
  const labels  = new Int32Array(n).fill(-1); // -1 = unvisited
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;

    // Find neighbours
    const neighbours: number[] = [];
    for (let j = 0; j < n; j++) {
      if (angleDist(segments[i].angleDeg, segments[j].angleDeg) <= eps) {
        neighbours.push(j);
      }
    }

    if (neighbours.length < minSupport) {
      labels[i] = 0; // noise
      continue;
    }

    clusterId++;
    labels[i] = clusterId;
    const seed = [...neighbours];

    let si = 0;
    while (si < seed.length) {
      const idx = seed[si++];
      if (labels[idx] === 0) labels[idx] = clusterId; // noise → border
      if (labels[idx] !== -1) continue;
      labels[idx] = clusterId;

      const nb2: number[] = [];
      for (let j = 0; j < n; j++) {
        if (angleDist(segments[idx].angleDeg, segments[j].angleDeg) <= eps) {
          nb2.push(j);
        }
      }
      if (nb2.length >= minSupport) {
        for (const j of nb2) if (!seed.includes(j)) seed.push(j);
      }
    }
  }

  // Group into clusters
  const clusterMap = new Map<number, RawSegment[]>();
  for (let i = 0; i < n; i++) {
    const cid = labels[i];
    if (cid <= 0) continue;
    if (!clusterMap.has(cid)) clusterMap.set(cid, []);
    clusterMap.get(cid)!.push(segments[i]);
  }

  return Array.from(clusterMap.values()).map(segs => ({
    medianAngleDeg: circularMean(segs.map(s => s.angleDeg)),
    segments: segs,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — OFFSET CLUSTERING
// ═══════════════════════════════════════════════════════════════════════════════

/** Project a point onto the normal of the given orientation family. */
function projectToNormal(p: Vec2, normalAngleDeg: number): number {
  const nRad = (normalAngleDeg * Math.PI) / 180;
  return p.x * Math.cos(nRad) + p.y * Math.sin(nRad);
}

/**
 * Group segments within an angle cluster by their perpendicular offset.
 * Uses offset tolerance from params (converted from mm to pixels via 1px ≈ 1mm at typical scale).
 */
function clusterByOffset(
  cluster:      AngleCluster,
  offsetTolPx:  number,
): OffsetGroup[] {
  // Normal direction is 90° from line direction
  const normalAngle = canonicalAngle(cluster.medianAngleDeg + 90);

  // Compute midpoint offset for each segment
  const offsets: Array<{ offset: number; seg: RawSegment }> = cluster.segments.map(s => {
    const mid = { x: (s.p0.x + s.p1.x) / 2, y: (s.p0.y + s.p1.y) / 2 };
    return { offset: projectToNormal(mid, normalAngle), seg: s };
  });

  offsets.sort((a, b) => a.offset - b.offset);

  const groups: OffsetGroup[] = [];
  for (const { offset, seg } of offsets) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(offset - last.offsetD) <= offsetTolPx) {
      last.segments.push(seg);
      // Update group offset as running mean
      const n = last.segments.length;
      last.offsetD = ((last.offsetD * (n - 1)) + offset) / n;
    } else {
      groups.push({ offsetD: offset, segments: [seg] });
    }
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — SEGMENT MERGING
// ═══════════════════════════════════════════════════════════════════════════════

interface Interval { t0: number; t1: number; }

/** Project a point onto a line direction vector, returning a scalar t. */
function projectOntoAxis(p: Vec2, axisOrigin: Vec2, dirVec: Vec2): number {
  return (p.x - axisOrigin.x) * dirVec.x + (p.y - axisOrigin.y) * dirVec.y;
}

/**
 * Merge collinear segments within an offset group.
 * Gaps ≤ gapTolPx are bridged. Returns the merged extent as p0, p1.
 */
function mergeCollinear(
  group:     OffsetGroup,
  dirVec:    Vec2,
  gapTolPx:  number,
): { p0: Vec2; p1: Vec2; segmentCount: number; totalLength: number } | null {
  if (group.segments.length === 0) return null;

  const origin = group.segments[0].p0;
  const intervals: Interval[] = group.segments.map(s => {
    const t0 = projectOntoAxis(s.p0, origin, dirVec);
    const t1 = projectOntoAxis(s.p1, origin, dirVec);
    return { t0: Math.min(t0, t1), t1: Math.max(t0, t1) };
  });

  intervals.sort((a, b) => a.t0 - b.t0);

  const merged: Interval[] = [];
  let cur = { ...intervals[0] };
  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    if (next.t0 - cur.t1 <= gapTolPx) {
      cur.t1 = Math.max(cur.t1, next.t1);
    } else {
      merged.push(cur);
      cur = { ...next };
    }
  }
  merged.push(cur);

  // Use the longest merged interval
  merged.sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0));
  const best = merged[0];

  const p0: Vec2 = { x: origin.x + best.t0 * dirVec.x, y: origin.y + best.t0 * dirVec.y };
  const p1: Vec2 = { x: origin.x + best.t1 * dirVec.x, y: origin.y + best.t1 * dirVec.y };
  const totalLength = group.segments.reduce((s, seg) => s + seg.length, 0);

  return {
    p0, p1,
    segmentCount: group.segments.length,
    totalLength,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — AXIS BUILDING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build consolidated axes from angle clusters + offset groups.
 * Confidence formula uses raster base (lower than DXF due to noise).
 */
function buildAxes(
  clusters:  AngleCluster[],
  gapTolPx:  number,
): MergedAxis[] {
  const axes: MergedAxis[] = [];

  for (let fi = 0; fi < clusters.length; fi++) {
    const cluster = clusters[fi];
    const tRad  = (cluster.medianAngleDeg * Math.PI) / 180;
    const dirVec: Vec2 = { x: Math.cos(tRad), y: Math.sin(tRad) };

    const groups = clusterByOffset(cluster, gapTolPx);

    for (const group of groups) {
      const merged = mergeCollinear(group, dirVec, gapTolPx);
      if (!merged) continue;

      const length = Math.hypot(merged.p1.x - merged.p0.x, merged.p1.y - merged.p0.y);
      if (length < 5) continue;

      // Raster confidence: base + bonus for segment count and total length
      const conf = Math.min(
        RASTER_MAX_CONF,
        RASTER_CONF_BASE + Math.min(0.15, group.segments.length * 0.03) +
          Math.min(0.10, merged.totalLength / 5000),
      );

      // Parametric extents (t values along dirVec from p0)
      const origin = merged.p0;
      const extentMinT = projectOntoAxis(merged.p0, origin, dirVec);
      const extentMaxT = projectOntoAxis(merged.p1, origin, dirVec);

      axes.push({
        p0: merged.p0,
        p1: merged.p1,
        offsetD: group.offsetD,
        familyIdx: fi,
        segmentCount: merged.segmentCount,
        totalLength: merged.totalLength,
        confidence: conf,
        extentMinT,
        extentMaxT,
      });
    }
  }

  // Sort each family's axes by offset
  axes.sort((a, b) => {
    if (a.familyIdx !== b.familyIdx) return a.familyIdx - b.familyIdx;
    return a.offsetD - b.offsetD;
  });

  return axes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — HOUGH CIRCLE DETECTION (Grid Bubbles)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simplified Hough circle transform to detect grid bubble markers.
 * Radius range is derived from page-area percentages (§13.4).
 *
 * For a W×H image:
 *   areaMinPct → minR = sqrt(W*H * areaMinPct / π)
 *   areaMaxPct → maxR = sqrt(W*H * areaMaxPct / π)
 */
function detectCircles(
  edges:       Uint8Array,
  width:       number,
  height:      number,
  areaMinPct:  number,
  areaMaxPct:  number,
): CircleCandidate[] {
  const pageArea = width * height;
  const minR = Math.max(4, Math.round(Math.sqrt(pageArea * areaMinPct / Math.PI)));
  const maxR = Math.round(Math.sqrt(pageArea * areaMaxPct / Math.PI));

  if (minR >= maxR) return [];

  const circles: CircleCandidate[] = [];

  for (let r = minR; r <= maxR; r++) {
    // Accumulator for circle centers at this radius
    const acc = new Int32Array(width * height);

    // Sample points on the circle perimeter
    const steps = Math.max(16, Math.round(2 * Math.PI * r));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!edges[y * width + x]) continue;
        for (let si = 0; si < steps; si++) {
          const theta = (si / steps) * 2 * Math.PI;
          const cx = Math.round(x + r * Math.cos(theta));
          const cy = Math.round(y + r * Math.sin(theta));
          if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
            acc[cy * width + cx]++;
          }
        }
      }
    }

    // Find peaks (vote threshold: ~40% of full circumference)
    const threshold = Math.round(steps * 0.40);
    const CWIN = Math.max(2, Math.round(r * 0.5));

    for (let cy = CWIN; cy < height - CWIN; cy++) {
      for (let cx = CWIN; cx < width - CWIN; cx++) {
        const v = acc[cy * width + cx];
        if (v < threshold) continue;

        // Local max
        let isMax = true;
        outer:
        for (let dy = -CWIN; dy <= CWIN; dy++) {
          for (let dx = -CWIN; dx <= CWIN; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (acc[(cy+dy) * width + (cx+dx)] > v) { isMax = false; break outer; }
          }
        }
        if (isMax) {
          circles.push({ cx, cy, radius: r, votes: v });
        }
      }
    }
  }

  // Non-max suppression across all radii: remove circles whose centres
  // are within minR of a higher-vote circle
  circles.sort((a, b) => b.votes - a.votes);
  const kept: CircleCandidate[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < circles.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(circles[i]);
    for (let j = i + 1; j < circles.length; j++) {
      if (suppressed.has(j)) continue;
      const dx = circles[j].cx - circles[i].cx;
      const dy = circles[j].cy - circles[i].cy;
      if (Math.sqrt(dx*dx + dy*dy) < minR) suppressed.add(j);
    }
  }

  return kept;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — OCR TEXT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract word-level text entities from the image via Tesseract.js.
 * Returns RawTextEntity[] compatible with grid-label-engine.
 */
async function extractOCRWords(
  imageBuffer: Buffer,
  warnings:    string[],
): Promise<RawTextEntity[]> {
  try {
    const { data } = await Tesseract.recognize(imageBuffer, 'eng', {
      tessedit_char_whitelist:
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-/.()',
    } as any);

    const words: RawTextEntity[] = [];

    for (const word of ((data as any)?.words ?? [])) {
      const raw = word.text?.trim() ?? '';
      if (!raw) continue;
      if (word.confidence < 15) continue; // Skip very low-confidence OCR hits

      const { x0, y0, x1, y1 } = word.bbox;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const _w  = x1 - x0;
      const h  = y1 - y0;

      words.push({
        text:       raw,
        position:   { x: cx, y: cy },
        height:     h,
        rotation:   0,
        layer:      'OCR',
        bbox:       { minX: x0, minY: y0, maxX: x1, maxY: y1 },
        source:     'OCR',
        confidence: word.confidence / 100,
      });
    }

    return words;
  } catch (err) {
    warnings.push(`OCR failed: ${(err as Error).message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — INTERSECTION COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

interface IntersectionPt {
  x:        number;
  y:        number;
  axisIdxA: number;
  axisIdxB: number;
  confidence: number;
}

/**
 * Compute line-line intersections between axes from different families.
 * Uses parametric form; validates intersections fall within both axes' extents.
 */
function computeRasterIntersections(
  axes:     MergedAxis[],
  _families: AngleCluster[],
): IntersectionPt[] {
  const intersections: IntersectionPt[] = [];
  const n = axes.length;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      if (axes[i].familyIdx === axes[j].familyIdx) continue;

      const a = axes[i], b = axes[j];
      const dx1 = a.p1.x - a.p0.x, dy1 = a.p1.y - a.p0.y;
      const dx2 = b.p1.x - b.p0.x, dy2 = b.p1.y - b.p0.y;
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) < 1e-9) continue;

      const dpx = b.p0.x - a.p0.x;
      const dpy = b.p0.y - a.p0.y;
      const t = (dpx * dy2 - dpy * dx2) / denom;
      const u = (dpx * dy1 - dpy * dx1) / denom;

      // Validate within reasonable extent of both axes (allow 10% overshoot)
      const lenA = Math.hypot(dx1, dy1) || 1;
      const lenB = Math.hypot(dx2, dy2) || 1;
      if (t < -0.1 * lenA || t > 1.1 * lenA) continue;
      if (u < -0.1 * lenB || u > 1.1 * lenB) continue;

      const x = a.p0.x + t * dx1;
      const y = a.p0.y + t * dy1;
      const conf = (a.confidence + b.confidence) / 2;

      intersections.push({ x, y, axisIdxA: i, axisIdxB: j, confidence: conf });
    }
  }

  return intersections;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14 — COORDINATE TRANSFORM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a pixel→model-space coordinate transform.
 * Uses DPI to convert pixels to meters: 1 inch = 0.0254m, so scale = 0.0254 / dpi.
 */
function buildPixelTransform(
  width:  number,
  height: number,
  dpi:    number,
  scale:  number,   // Resize ratio applied during preprocessing
): InsertGridCoordinateTransform {
  // Effective DPI accounts for resize: if image was downscaled, each pixel
  // in the processed image corresponds to 1/scale pixels in the original.
  const effectiveDpi = dpi / scale;
  const metersPerPixel = 0.0254 / effectiveDpi;

  return {
    projectId:         '',   // Filled in by orchestrator persistExtractorResults
    fromFrame:         'IMAGE_PX',
    toFrame:           'MODEL',
    matrix2x3:         [[metersPerPixel, 0, 0], [0, metersPerPixel, 0]],
    scale:             String(metersPerPixel.toFixed(10)),
    rotationDeg:       '0',
    translationX:      '0',
    translationY:      '0',
    calibrationMethod: 'OTHER', // DPI-derived pixel→metre scale (no enum value for this)
    sourceUnit:        'px',
    targetUnit:        'm',
    notes:             `Raster path: ${effectiveDpi.toFixed(0)} effective DPI → ${metersPerPixel.toFixed(6)} m/px`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15 — PACKAGE EXTRACTOR RESULT
// ═══════════════════════════════════════════════════════════════════════════════

function dirVec(angleDeg: number): Vec2 {
  const r = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
}

function normalVec(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}

function packageRasterResult(
  clusters:      AngleCluster[],
  axes:          MergedAxis[],
  circles:       CircleCandidate[],
  ocrWords:      RawTextEntity[],
  intersections: IntersectionPt[],
  img:           ProcessedImage,
  runId:         string,
  params:        typeof DEFAULT_DETECTION_PARAMS,
  warnings:      string[],
  errors:        string[],
  startTime:     number,
): ExtractorResult {
  const bounds: BBox = {
    minX: 0, minY: 0, maxX: img.width, maxY: img.height,
  };

  // ── Component ──
  const components: InsertGridComponent[] = [{
    runId,
    name:         'Main',
    bboxMinX:     '0',
    bboxMinY:     '0',
    bboxMaxX:     String(img.width),
    bboxMaxY:     String(img.height),
    primaryFrame: 'IMAGE_PX',
    confidence:   String(
      Math.min(RASTER_MAX_CONF,
        RASTER_CONF_BASE + Math.min(0.20, clusters.length * 0.05)
      ).toFixed(3)
    ),
  }];

  // ── Families ──
  const familyInserts: InsertGridFamily[] = clusters.map((cluster, fi) => {
    const dir  = dirVec(cluster.medianAngleDeg);
    const norm = normalVec(dir);
    const totalLen = cluster.segments.reduce((s, seg) => s + seg.length, 0);
    const conf = Math.min(RASTER_MAX_CONF, RASTER_CONF_BASE + Math.min(0.20, totalLen / 8000));
    return {
      componentId:    '0',
      thetaDeg:       String(cluster.medianAngleDeg.toFixed(4)),
      directionVecX:  String(dir.x.toFixed(8)),
      directionVecY:  String(dir.y.toFixed(8)),
      normalVecX:     String(norm.x.toFixed(8)),
      normalVecY:     String(norm.y.toFixed(8)),
      familyRank:     fi + 1,
      confidence:     String(conf.toFixed(3)),
    };
  });

  // ── Axes ──
  const axisInserts: InsertGridAxis[] = axes.map(axis => ({
    familyId:           String(axis.familyIdx),
    geometryType:       'LINE' as const,
    p0X:                String(axis.p0.x.toFixed(4)),
    p0Y:                String(axis.p0.y.toFixed(4)),
    p1X:                String(axis.p1.x.toFixed(4)),
    p1Y:                String(axis.p1.y.toFixed(4)),
    offsetD:            String(axis.offsetD.toFixed(4)),
    extentMinT:         String(axis.extentMinT.toFixed(4)),
    extentMaxT:         String(axis.extentMaxT.toFixed(4)),
    axisStyle:          { source: 'RASTER' },
    segmentCount:       axis.segmentCount,
    totalMergedLength:  String(axis.totalLength.toFixed(2)),
    confidence:         String(axis.confidence.toFixed(3)),
    // Raster axes always NEEDS_REVIEW unless they score above autoAssignThreshold
    // downstream after label scoring — start as NEEDS_REVIEW
    status:             axis.confidence >= params.autoAssignThreshold ? 'AUTO' : 'NEEDS_REVIEW' as const,
  }));

  // ── Build label-engine inputs ──
  const contentBounds: ContentBounds = {
    minX: bounds.minX, minY: bounds.minY,
    maxX: bounds.maxX, maxY: bounds.maxY,
    width: img.width, height: img.height,
    diagonal: Math.sqrt(img.width**2 + img.height**2),
  };

  const circleShapes: RawCircleShape[] = circles.map(c => ({
    center:      { x: c.cx, y: c.cy },
    radius:      c.radius,
    layer:       'RASTER_CIRCLE',
    source:      'CIRCLE' as const,
  }));

  const axisGeometries: AxisGeometry[] = axes.map((axis, idx) => ({
    index:       idx,
    familyIndex: axis.familyIdx,
    p0:          axis.p0,
    p1:          axis.p1,
    confidence:  axis.confidence,
  }));

  const engineParams: LabelEngineParams = {
    markerSearchRadiusPct:  params.markerSearchRadiusPct,
    markerAreaMinPct:       params.markerAreaMinPct,
    markerAreaMaxPct:       params.markerAreaMaxPct,
    markerCircularityMin:   params.markerCircularityMin,
    labelScoreWeights:      params.labelScoreWeights,
    autoAssignThreshold:    params.autoAssignThreshold,
    autoAssignMargin:       params.autoAssignMargin,
    reviewThreshold:        params.reviewThreshold,
  };

  const labelResult = runLabelEngine(
    circleShapes, [], [], ocrWords,
    axisGeometries, contentBounds, engineParams,
  );
  warnings.push(...labelResult.warnings);

  for (const seq of labelResult.sequences) {
    if (seq.gaps.length > 0 || seq.duplicates.length > 0) {
      warnings.push(
        `Raster sequence family ${seq.familyIndex}: type=${seq.sequenceType}, ` +
        `detected=[${seq.detectedLabels.join(',')}]` +
        (seq.gaps.length > 0 ? `, GAPS=[${seq.gaps.join(',')}]` : '') +
        (seq.duplicates.length > 0 ? `, DUPLICATES=[${seq.duplicates.join(',')}]` : ''),
      );
    }
  }

  const { markers: markerInserts, labels: labelInserts, axisLabels: axisLabelInserts } =
    convertToInsertTypes(labelResult);

  // ── Nodes ──
  const nodeInserts: InsertGridNode[] = intersections.map(pt => ({
    componentId: '0',
    x:           String(pt.x.toFixed(4)),
    y:           String(pt.y.toFixed(4)),
    confidence:  String(pt.confidence.toFixed(3)),
  }));

  // ── Node-Axis links ──
  const nodeAxisInserts: InsertGridNodeAxis[] = [];
  for (let ni = 0; ni < intersections.length; ni++) {
    const pt = intersections[ni];
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(pt.axisIdxA) });
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(pt.axisIdxB) });
  }

  // ── Coordinate transform ──
  const transform = buildPixelTransform(img.width, img.height, img.dpi, img.scale);

  return {
    success:     true,
    components,
    families:    familyInserts,
    axes:        axisInserts,
    markers:     markerInserts,
    labels:      labelInserts,
    axisLabels:  axisLabelInserts,
    nodes:       nodeInserts,
    nodeAxes:    nodeAxisInserts,
    transform,
    warnings,
    errors,
    extractionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACTOR OBJECT
// ═══════════════════════════════════════════════════════════════════════════════

export const rasterGridExtractor: GridExtractor = {
  name:           'RasterGridExtractor',
  supportedTypes: ['IMAGE', 'PDF_RASTER'],

  async extract(
    buffer:         Buffer,
    classification: InputClassification,
    params:         typeof DEFAULT_DETECTION_PARAMS,
    runId:          string,
  ): Promise<ExtractorResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors:   string[] = [];

    const failResult = (): ExtractorResult => ({
      success:         false,
      components:      [],
      families:        [],
      axes:            [],
      markers:         [],
      labels:          [],
      axisLabels:      [],
      nodes:           [],
      nodeAxes:        [],
      warnings,
      errors,
      extractionTimeMs: Date.now() - startTime,
    });

    // ── Step 1: Normalize input to image buffer ──
    const pageNo    = 1; // Raster extraction always operates on page 1
    const imgBuffer = await normalizeInputToImageBuffer(buffer, classification, pageNo, warnings);
    if (!imgBuffer) {
      errors.push('Input normalization failed — cannot proceed with raster grid extraction');
      return failResult();
    }

    // ── Step 2: Preprocess image ──
    const img = await preprocessImage(imgBuffer, warnings);
    if (!img) {
      errors.push('Image preprocessing failed — cannot proceed with raster grid extraction');
      return failResult();
    }

    warnings.push(
      `Raster image: ${img.width}×${img.height}px, ` +
      `scale=${img.scale.toFixed(3)}, dpi=${img.dpi}`
    );

    // ── Step 3 & 4: Sobel + Hough (done inside preprocessImage for Sobel) ──
    const diagonal = Math.sqrt(img.width * img.width + img.height * img.height);
    const minVotes = Math.max(20, Math.round(params.candidateMinLengthPct * diagonal));
    warnings.push(`Hough minVotes=${minVotes} (candidateMinLengthPct=${params.candidateMinLengthPct})`);

    const peaks = houghLines(img.edges, img.width, img.height, minVotes);
    warnings.push(`Hough: ${peaks.length} peaks detected above ${minVotes} votes`);

    if (peaks.length < 2) {
      errors.push(
        `Insufficient Hough peaks (${peaks.length}) — ` +
        `image may be too low-resolution, heavily scanned, or contain no structural grid. ` +
        `RFI required: request vector or higher-quality drawing.`
      );
      return failResult();
    }

    // ── Step 5: Extract segments ──
    const rawSegments = extractSegmentsFromHough(peaks, img.edges, img.width, img.height);
    warnings.push(`Segments extracted: ${rawSegments.length}`);

    if (rawSegments.length < 4) {
      errors.push(
        `Too few segments (${rawSegments.length}) — cannot form a grid. ` +
        `RFI required: confirm drawing contains structural grid lines.`
      );
      return failResult();
    }

    // ── Steps 6–7: Angle clustering ──
    const clusters = dbscanAngleClusters(
      rawSegments,
      params.angleClusterEpsDeg,
      params.angleClusterMinSupport,
    );
    warnings.push(`Angle families: ${clusters.length} (DBSCAN eps=${params.angleClusterEpsDeg}°)`);

    if (clusters.length < 1) {
      errors.push(
        `No orientation families detected from ${rawSegments.length} segments. ` +
        `Possible cause: consistent grid angle not present or drawing is rotated beyond tolerance.`
      );
      return failResult();
    }

    // ── Steps 8–10: Build axes ──
    // offsetToleranceMm is in mm; raster operates in pixels.
    // At DEFAULT_ASSUMED_DPI=150, 1mm ≈ 5.9px. Apply approximate conversion.
    const pxPerMm    = (img.dpi / 25.4) * img.scale;
    const _offsetTolPx = params.offsetToleranceMm * pxPerMm;
    const gapTolPx    = params.gapMergeToleranceMm * pxPerMm;

    const axes = buildAxes(clusters, gapTolPx);
    warnings.push(`Axes consolidated: ${axes.length}`);

    if (axes.length < 2) {
      errors.push(
        `Only ${axes.length} axis detected — minimum 2 required for grid. ` +
        `RFI required: verify drawing sheet contains primary grid system.`
      );
      return failResult();
    }

    // ── Step 11: Circle detection ──
    const circles = detectCircles(
      img.edges, img.width, img.height,
      params.markerAreaMinPct,
      params.markerAreaMaxPct,
    );
    warnings.push(`Circle markers detected: ${circles.length}`);

    // ── Step 12: OCR text extraction ──
    const ocrWords = await extractOCRWords(imgBuffer, warnings);
    warnings.push(`OCR words extracted: ${ocrWords.length}`);

    // ── Step 13: Intersection nodes ──
    const intersections = computeRasterIntersections(axes, clusters);
    warnings.push(`Grid nodes (intersections): ${intersections.length}`);

    // ── Steps 14–15: Package and return ──
    return packageRasterResult(
      clusters, axes, circles, ocrWords, intersections,
      img, runId, params,
      warnings, errors, startTime,
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

registerGridExtractor(rasterGridExtractor);

console.log('📐 Raster Grid Extractor v1 registered (IMAGE, PDF_RASTER)');

export default rasterGridExtractor;
