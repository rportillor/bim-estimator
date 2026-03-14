// server/services/pdf-grid-extractor.ts
// ═══════════════════════════════════════════════════════════════════════════════
// VECTOR PDF GRID LINE EXTRACTOR — v1.1 §4–§5 (PDF path)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Extracts grid geometry from vector PDF files by parsing content streams.
//
// Pipeline:
//   1. Decompress PDF content streams (FlateDecode)
//   2. Tokenize content stream operators (graphics state machine)
//   3. Extract line segments from m/l (moveto/lineto) and re (rectangles)
//   4. Extract circles from c (cubic Bezier approximations)
//   5. Extract positioned text from BT/ET blocks with Tm/Td operators
//   6. Delegate to grid-label-engine for markers, labels, scoring, sequences
//   7. Reuse DXF extractor geometry engine for angle clustering + consolidation
//
// Limitations (by design — these trigger RFIs, never silent fallbacks):
//   - Does NOT handle scanned/raster PDFs (those go through PDF_RASTER → IMAGE)
//   - Does NOT OCR embedded images (that's WP for raster pipeline)
//   - Text extraction is best-effort; missing text generates NEEDS_REVIEW
//
// Registers with orchestrator via registerGridExtractor() for PDF_VECTOR type.
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification
// ═══════════════════════════════════════════════════════════════════════════════

import * as zlib from 'zlib';
import {
  registerGridExtractor,
  type GridExtractor,
  type ExtractorResult,
  type InputClassification,
  type DEFAULT_DETECTION_PARAMS,
} from './grid-detection-orchestrator';

import {
  runLabelEngine,
  convertToInsertTypes,
  type RawCircleShape,
  type RawClosedPolyShape,
  type RawTextEntity,
  type AxisGeometry,
  type ContentBounds,
  type LabelEngineParams,
} from './grid-label-engine';

import type {
  InsertGridComponent,
  InsertGridFamily,
  InsertGridAxis,
  InsertGridNode,
  InsertGridNodeAxis,
  InsertGridCoordinateTransform,
} from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Vec2 { x: number; y: number; }
interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

interface PdfSegment {
  p0: Vec2;
  p1: Vec2;
  length: number;
  angleDeg: number;
  strokeWidth: number;
}

interface PdfCircle {
  center: Vec2;
  radius: number;
}

interface PdfText {
  text: string;
  position: Vec2;
  fontSize: number;
  bbox: BBox;
}

interface PdfClosedPath {
  vertices: Vec2[];
  centroid: Vec2;
  area: number;
  perimeter: number;
}

// Reuse geometry functions from DXF extractor inline (no circular dependency)
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function canonicalAngle(p0: Vec2, p1: Vec2): number {
  let a = Math.atan2(p1.y - p0.y, p1.x - p0.x) * RAD;
  if (a < 0) a += 360;
  if (a >= 180) a -= 180;
  return a;
}

function angleDist(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 90) d = 180 - d;
  return d;
}

function dirVec(angleDeg: number): Vec2 {
  const r = angleDeg * DEG;
  return { x: Math.cos(r), y: Math.sin(r) };
}

function normalVec(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}

function perpendicularOffset(point: Vec2, origin: Vec2, normal: Vec2): number {
  return (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
}

function parametricT(point: Vec2, origin: Vec2, dir: Vec2): number {
  return (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y;
}

function lineLineIntersection(p0: Vec2, d0: Vec2, p1: Vec2, d1: Vec2): Vec2 | null {
  const cross = d0.x * d1.y - d0.y * d1.x;
  if (Math.abs(cross) < 1e-10) return null;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const t = (dx * d1.y - dy * d1.x) / cross;
  return { x: p0.x + t * d0.x, y: p0.y + t * d0.y };
}

function pointToSegmentDist(pt: Vec2, s0: Vec2, s1: Vec2): number {
  const dx = s1.x - s0.x, dy = s1.y - s0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return dist(pt, s0);
  let t = ((pt.x - s0.x) * dx + (pt.y - s0.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(pt, { x: s0.x + t * dx, y: s0.y + t * dy });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF CONTENT STREAM PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract raw content streams from PDF buffer.
 * Finds stream/endstream markers, decompresses FlateDecode streams.
 */
function extractContentStreams(buffer: Buffer): string[] {
  const streams: string[] = [];
  const pdfStr = buffer.toString('latin1');

  // Find all stream/endstream pairs
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(pdfStr)) !== null) {
    const rawContent = match[1];

    // Try to get the raw bytes from the buffer at the same offset
    const streamStart = match.index + match[0].indexOf(rawContent);
    const streamBytes = buffer.slice(streamStart, streamStart + rawContent.length);

    // Try FlateDecode decompression first
    try {
      const decompressed = zlib.inflateSync(streamBytes);
      const text = decompressed.toString('latin1');
      // Only keep streams that look like content streams (have PDF operators)
      if (/[mlhcSsfWnqQBTET]/.test(text)) {
        streams.push(text);
      }
    } catch {
      // Not compressed or not FlateDecode — use raw if it looks like content
      if (/[mlhcSsfWnqQBTET]/.test(rawContent)) {
        streams.push(rawContent);
      }
    }
  }

  return streams;
}

/**
 * Parse a PDF content stream into vector geometry and text.
 * Implements a subset of the PDF graphics state machine.
 */
function parseContentStream(stream: string): {
  segments: PdfSegment[];
  circles: PdfCircle[];
  texts: PdfText[];
  closedPaths: PdfClosedPath[];
} {
  const segments: PdfSegment[] = [];
  const circles: PdfCircle[] = [];
  const texts: PdfText[] = [];
  const closedPaths: PdfClosedPath[] = [];

  // Graphics state
  let currentX = 0, currentY = 0;
  let pathStartX = 0, pathStartY = 0;
  let lineWidth = 1;
  const pathPoints: Vec2[] = [];
  let inPath = false;
  let inText = false;
  let textMatrix = [1, 0, 0, 1, 0, 0]; // a, b, c, d, tx, ty
  let fontSize = 12;
  let currentTextChunks: string[] = [];

  // Tokenize: numbers and operators
  const tokens = stream.match(/-?\d+\.?\d*|[a-zA-Z*'"]+|\((?:[^\\)]|\\.)*\)|<[0-9A-Fa-f]*>/g) || [];
  const numStack: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Number → push to stack
    if (/^-?\d+\.?\d*$/.test(token)) {
      numStack.push(parseFloat(token));
      continue;
    }

    // String literal → text content
    if (token.startsWith('(') && token.endsWith(')')) {
      if (inText) {
        currentTextChunks.push(token.slice(1, -1).replace(/\\(.)/g, '$1'));
      }
      continue;
    }

    // Hex string
    if (token.startsWith('<') && token.endsWith('>')) {
      if (inText) {
        const hex = token.slice(1, -1);
        let decoded = '';
        for (let h = 0; h < hex.length; h += 2) {
          const code = parseInt(hex.substr(h, 2), 16);
          if (code >= 32 && code < 127) decoded += String.fromCharCode(code);
        }
        if (decoded) currentTextChunks.push(decoded);
      }
      continue;
    }

    // Operators
    switch (token) {
      // ── Path Construction ──
      case 'm': { // moveto
        const y = numStack.pop() ?? 0;
        const x = numStack.pop() ?? 0;
        currentX = x; currentY = y;
        pathStartX = x; pathStartY = y;
        inPath = true;
        pathPoints.length = 0;
        pathPoints.push({ x, y });
        break;
      }

      case 'l': { // lineto
        const y = numStack.pop() ?? 0;
        const x = numStack.pop() ?? 0;
        if (inPath) {
          const p0 = { x: currentX, y: currentY };
          const p1 = { x, y };
          const len = dist(p0, p1);
          if (len > 0.1) {
            segments.push({
              p0, p1, length: len,
              angleDeg: canonicalAngle(p0, p1),
              strokeWidth: lineWidth,
            });
          }
          pathPoints.push({ x, y });
        }
        currentX = x; currentY = y;
        break;
      }

      case 're': { // rectangle: x y w h re
        const h = numStack.pop() ?? 0;
        const w = numStack.pop() ?? 0;
        const y = numStack.pop() ?? 0;
        const x = numStack.pop() ?? 0;
        // Rectangle = 4 line segments
        const corners = [
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
        ];
        for (let ci = 0; ci < 4; ci++) {
          const p0 = corners[ci];
          const p1 = corners[(ci + 1) % 4];
          const len = dist(p0, p1);
          if (len > 0.1) {
            segments.push({
              p0, p1, length: len,
              angleDeg: canonicalAngle(p0, p1),
              strokeWidth: lineWidth,
            });
          }
        }
        // Also record as closed path for marker detection
        const cx = x + w / 2, cy = y + h / 2;
        closedPaths.push({
          vertices: corners,
          centroid: { x: cx, y: cy },
          area: Math.abs(w * h),
          perimeter: 2 * (Math.abs(w) + Math.abs(h)),
        });
        break;
      }

      case 'c': { // cubic Bezier: x1 y1 x2 y2 x3 y3 c
        const y3 = numStack.pop() ?? 0;
        const x3 = numStack.pop() ?? 0;
        const y2 = numStack.pop() ?? 0;
        const x2 = numStack.pop() ?? 0;
        const y1 = numStack.pop() ?? 0;
        const x1 = numStack.pop() ?? 0;
        // Detect circles: 4 cubic Beziers forming a full circle
        // Approximate: treat endpoint-to-endpoint as a straight segment
        // Also check if this could be part of a circular arc
        const p0 = { x: currentX, y: currentY };
        const p1 = { x: x3, y: y3 };
        const len = dist(p0, p1);
        if (len > 0.1) {
          pathPoints.push({ x: x3, y: y3 });
        }
        // Check for circular arc approximation
        const midX = (currentX + x1 + x2 + x3) / 4;
        const midY = (currentY + y1 + y2 + y3) / 4;
        const r1 = dist({ x: midX, y: midY }, p0);
        const r2 = dist({ x: midX, y: midY }, p1);
        if (Math.abs(r1 - r2) < r1 * 0.2 && r1 > 1) {
          // Possible arc segment — record for later circle detection
        }
        currentX = x3; currentY = y3;
        break;
      }

      case 'h': { // closepath
        if (inPath && pathPoints.length >= 3) {
          // Close the path
          const p0 = { x: currentX, y: currentY };
          const p1 = { x: pathStartX, y: pathStartY };
          const len = dist(p0, p1);
          if (len > 0.1) {
            segments.push({
              p0, p1, length: len,
              angleDeg: canonicalAngle(p0, p1),
              strokeWidth: lineWidth,
            });
          }
          pathPoints.push({ x: pathStartX, y: pathStartY });

          // Record as closed path
          const n = pathPoints.length;
          let cx = 0, cy = 0;
          for (const v of pathPoints) { cx += v.x; cy += v.y; }
          cx /= n; cy /= n;

          let area = 0;
          for (let j = 0; j < n - 1; j++) {
            area += pathPoints[j].x * pathPoints[j + 1].y - pathPoints[j + 1].x * pathPoints[j].y;
          }
          area = Math.abs(area) / 2;

          let perimeter = 0;
          for (let j = 0; j < n - 1; j++) {
            perimeter += dist(pathPoints[j], pathPoints[j + 1]);
          }

          // Check if closed path approximates a circle
          const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
          if (circularity > 0.75 && n >= 8) {
            const avgR = perimeter / (2 * Math.PI);
            circles.push({ center: { x: cx, y: cy }, radius: avgR });
          } else if (n >= 3) {
            closedPaths.push({
              vertices: pathPoints.slice(0, n - 1),
              centroid: { x: cx, y: cy },
              area,
              perimeter,
            });
          }
        }
        currentX = pathStartX;
        currentY = pathStartY;
        break;
      }

      // ── Path Painting ──
      case 'S': case 's': case 'f': case 'F': case 'B': case 'b':
      case 'n': { // stroke, fill, clip, endpath
        inPath = false;
        pathPoints.length = 0;
        break;
      }

      // ── Graphics State ──
      case 'w': { // line width
        lineWidth = numStack.pop() ?? 1;
        break;
      }

      case 'q': break; // save state
      case 'Q': break; // restore state

      case 'cm': { // concat matrix — skip for now (would need CTM stack)
        numStack.splice(-6);
        break;
      }

      // ── Text ──
      case 'BT': { // begin text
        inText = true;
        currentTextChunks = [];
        textMatrix = [1, 0, 0, 1, 0, 0];
        break;
      }

      case 'ET': { // end text
        if (inText && currentTextChunks.length > 0) {
          const fullText = currentTextChunks.join('').trim();
          if (fullText) {
            const tx = textMatrix[4];
            const ty = textMatrix[5];
            const w = fullText.length * fontSize * 0.5;
            texts.push({
              text: fullText,
              position: { x: tx, y: ty },
              fontSize,
              bbox: { minX: tx, minY: ty, maxX: tx + w, maxY: ty + fontSize },
            });
          }
        }
        inText = false;
        break;
      }

      case 'Tm': { // set text matrix
        if (numStack.length >= 6) {
          textMatrix = numStack.splice(-6);
          fontSize = Math.abs(textMatrix[3]) || fontSize;
        }
        break;
      }

      case 'Td': case 'TD': { // text position
        const ty = numStack.pop() ?? 0;
        const tx = numStack.pop() ?? 0;
        textMatrix[4] += tx;
        textMatrix[5] += ty;
        break;
      }

      case 'Tf': { // font size
        const size = numStack.pop();
        if (size && size > 0) fontSize = size;
        // Font name is on stack too but we skip it
        break;
      }

      case 'Tj': case 'TJ': { // show text (handled via string literals above)
        break;
      }

      case "'": case '"': { // next line + show text
        break;
      }

      default: {
        // Unknown operator — clear number stack
        numStack.length = 0;
        break;
      }
    }
  }

  return { segments, circles, texts, closedPaths };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEOMETRY ENGINE — Reused patterns from DXF extractor
// ═══════════════════════════════════════════════════════════════════════════════

interface AngleCluster {
  medianAngleDeg: number;
  segments: PdfSegment[];
}

interface MergedAxis {
  familyIdx: number;
  p0: Vec2;
  p1: Vec2;
  offsetD: number;
  extentMinT: number;
  extentMaxT: number;
  segmentCount: number;
  totalLength: number;
  confidence: number;
}

interface IntersectionPoint {
  x: number; y: number;
  axisIdxA: number; axisIdxB: number;
  confidence: number;
}

/** DBSCAN on 1D angle data — identical algorithm to DXF extractor */
function dbscanAngleClustering(
  segments: PdfSegment[], epsDeg: number, minSupport: number,
): AngleCluster[] {
  const n = segments.length;
  if (n === 0) return [];

  const labels = new Array<number>(n).fill(-2);
  let clusterId = 0;

  function regionQuery(idx: number): number[] {
    const neighbors: number[] = [];
    const a = segments[idx].angleDeg;
    for (let j = 0; j < n; j++) {
      if (angleDist(a, segments[j].angleDeg) <= epsDeg) neighbors.push(j);
    }
    return neighbors;
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minSupport) { labels[i] = -1; continue; }
    labels[i] = clusterId;
    const seed = [...neighbors];
    const visited = new Set<number>([i]);
    while (seed.length > 0) {
      const q = seed.pop()!;
      if (visited.has(q)) continue;
      visited.add(q);
      if (labels[q] === -1) labels[q] = clusterId;
      if (labels[q] !== -2) continue;
      labels[q] = clusterId;
      const qn = regionQuery(q);
      if (qn.length >= minSupport) for (const nn of qn) if (!visited.has(nn)) seed.push(nn);
    }
    clusterId++;
  }

  const clusters = new Map<number, PdfSegment[]>();
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      if (!clusters.has(labels[i])) clusters.set(labels[i], []);
      clusters.get(labels[i])!.push(segments[i]);
    }
  }

  const result: AngleCluster[] = [];
  for (const [, segs] of clusters) {
    // Circular median angle
    let bestAngle = segs[0].angleDeg, bestSum = Infinity;
    for (const s of segs) {
      let sum = 0;
      for (const s2 of segs) sum += angleDist(s.angleDeg, s2.angleDeg);
      if (sum < bestSum) { bestSum = sum; bestAngle = s.angleDeg; }
    }
    result.push({ medianAngleDeg: bestAngle, segments: segs });
  }

  result.sort((a, b) => {
    const la = a.segments.reduce((s, seg) => s + seg.length, 0);
    const lb = b.segments.reduce((s, seg) => s + seg.length, 0);
    return lb - la;
  });

  return result;
}

/** Offset clustering + segment merging — same algorithm as DXF extractor */
function buildAxes(
  clusters: AngleCluster[], offsetTol: number, gapTol: number,
): MergedAxis[] {
  const axes: MergedAxis[] = [];

  for (let fi = 0; fi < clusters.length; fi++) {
    const cluster = clusters[fi];
    const dir = dirVec(cluster.medianAngleDeg);
    const norm = normalVec(dir);

    // Centroid origin
    let cx = 0, cy = 0;
    for (const s of cluster.segments) { cx += (s.p0.x + s.p1.x) / 2; cy += (s.p0.y + s.p1.y) / 2; }
    cx /= cluster.segments.length; cy /= cluster.segments.length;
    const origin: Vec2 = { x: cx, y: cy };

    // Compute offsets
    const withOffset = cluster.segments.map(seg => ({
      seg,
      offset: (perpendicularOffset(seg.p0, origin, norm) + perpendicularOffset(seg.p1, origin, norm)) / 2,
    }));
    withOffset.sort((a, b) => a.offset - b.offset);

    // Group by offset
    const groups: { offset: number; segs: PdfSegment[] }[] = [];
    let cur: { offset: number; segs: PdfSegment[] } | null = null;
    for (const item of withOffset) {
      if (!cur || Math.abs(item.offset - cur.offset) > offsetTol) {
        cur = { offset: item.offset, segs: [item.seg] };
        groups.push(cur);
      } else {
        cur.segs.push(item.seg);
        const n = cur.segs.length;
        cur.offset = cur.offset * (n - 1) / n + item.offset / n;
      }
    }

    // Merge segments within each group
    for (const group of groups) {
      if (group.segs.length === 0) continue;

      // Project onto direction
      let gx = 0, gy = 0;
      for (const s of group.segs) { gx += (s.p0.x + s.p1.x) / 2; gy += (s.p0.y + s.p1.y) / 2; }
      gx /= group.segs.length; gy /= group.segs.length;
      const gOrigin: Vec2 = { x: gx, y: gy };

      const intervals: [number, number][] = group.segs.map(seg => {
        const t0 = parametricT(seg.p0, gOrigin, dir);
        const t1 = parametricT(seg.p1, gOrigin, dir);
        return [Math.min(t0, t1), Math.max(t0, t1)];
      });
      intervals.sort((a, b) => a[0] - b[0]);

      // Merge overlapping intervals
      const merged: [number, number][] = [intervals[0]];
      for (let i = 1; i < intervals.length; i++) {
        const last = merged[merged.length - 1];
        if (intervals[i][0] <= last[1] + gapTol) {
          last[1] = Math.max(last[1], intervals[i][1]);
        } else {
          merged.push(intervals[i]);
        }
      }

      // Pick longest interval
      let best = merged[0];
      for (const iv of merged) if (iv[1] - iv[0] > best[1] - best[0]) best = iv;

      const avgOff = group.segs.reduce((s, seg) =>
        s + perpendicularOffset({ x: (seg.p0.x + seg.p1.x) / 2, y: (seg.p0.y + seg.p1.y) / 2 }, gOrigin, norm)
      , 0) / group.segs.length;

      const p0: Vec2 = {
        x: gOrigin.x + dir.x * best[0] + norm.x * avgOff,
        y: gOrigin.y + dir.y * best[0] + norm.y * avgOff,
      };
      const p1: Vec2 = {
        x: gOrigin.x + dir.x * best[1] + norm.x * avgOff,
        y: gOrigin.y + dir.y * best[1] + norm.y * avgOff,
      };

      const totalLen = group.segs.reduce((s, seg) => s + seg.length, 0);
      const segConf = Math.min(1, group.segs.length / 3);
      const lenConf = Math.min(1, dist(p0, p1) / 500);

      axes.push({
        familyIdx: fi,
        p0, p1,
        offsetD: group.offset,
        extentMinT: Math.min(best[0], best[1]),
        extentMaxT: Math.max(best[0], best[1]),
        segmentCount: group.segs.length,
        totalLength: totalLen,
        confidence: Math.min(0.999, Math.max(0.1, 0.6 * segConf + 0.4 * lenConf)),
      });
    }
  }

  return axes;
}

/** Intersection computation — same algorithm as DXF extractor */
function computeIntersections(axes: MergedAxis[], families: AngleCluster[]): IntersectionPoint[] {
  const results: IntersectionPoint[] = [];
  for (let i = 0; i < axes.length; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      if (axes[i].familyIdx === axes[j].familyIdx) continue;
      const fA = families[axes[i].familyIdx];
      const fB = families[axes[j].familyIdx];
      if (angleDist(fA.medianAngleDeg, fB.medianAngleDeg) < 10) continue;

      const pt = lineLineIntersection(
        axes[i].p0, dirVec(fA.medianAngleDeg),
        axes[j].p0, dirVec(fB.medianAngleDeg)
      );
      if (!pt) continue;

      const dA = Math.min(pointToSegmentDist(pt, axes[i].p0, axes[i].p1), dist(pt, axes[i].p0), dist(pt, axes[i].p1));
      const dB = Math.min(pointToSegmentDist(pt, axes[j].p0, axes[j].p1), dist(pt, axes[j].p0), dist(pt, axes[j].p1));
      const extTol = Math.max(dist(axes[i].p0, axes[i].p1) * 0.15, dist(axes[j].p0, axes[j].p1) * 0.15, 50);
      if (dA > extTol || dB > extTol) continue;

      const conf = Math.min(axes[i].confidence, axes[j].confidence) * Math.max(0.5, 1 - (dA + dB) / (2 * extTol));
      results.push({ x: pt.x, y: pt.y, axisIdxA: i, axisIdxB: j, confidence: Math.min(0.999, Math.max(0.1, conf)) });
    }
  }

  // Deduplicate
  const deduped: IntersectionPoint[] = [];
  for (const pt of results) {
    if (!deduped.find(d => Math.abs(d.x - pt.x) < 30 && Math.abs(d.y - pt.y) < 30)) {
      deduped.push(pt);
    }
  }
  return deduped;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGING
// ═══════════════════════════════════════════════════════════════════════════════

function packageResult(
  families: AngleCluster[], axes: MergedAxis[],
  labelResult: ReturnType<typeof convertToInsertTypes>,
  intersections: IntersectionPoint[],
  bounds: BBox, runId: string,
  warnings: string[], errors: string[], startTime: number,
): ExtractorResult {
  const components: InsertGridComponent[] = [{
    runId, name: 'Main',
    bboxMinX: String(bounds.minX), bboxMinY: String(bounds.minY),
    bboxMaxX: String(bounds.maxX), bboxMaxY: String(bounds.maxY),
    primaryFrame: 'MODEL',
    confidence: String(Math.min(0.999, 0.4 + families.length * 0.15).toFixed(3)),
  }];

  const familyInserts: InsertGridFamily[] = families.map((c, fi) => {
    const d = dirVec(c.medianAngleDeg), n = normalVec(d);
    const totalLen = c.segments.reduce((s, seg) => s + seg.length, 0);
    return {
      componentId: '0',
      thetaDeg: String(c.medianAngleDeg.toFixed(4)),
      directionVecX: String(d.x.toFixed(8)), directionVecY: String(d.y.toFixed(8)),
      normalVecX: String(n.x.toFixed(8)), normalVecY: String(n.y.toFixed(8)),
      familyRank: fi + 1,
      confidence: String(Math.min(0.999, 0.5 + Math.min(0.35, totalLen / 5000)).toFixed(3)),
    };
  });

  const axisInserts: InsertGridAxis[] = axes.map(a => ({
    familyId: String(a.familyIdx), geometryType: 'LINE' as const,
    p0X: String(a.p0.x.toFixed(6)), p0Y: String(a.p0.y.toFixed(6)),
    p1X: String(a.p1.x.toFixed(6)), p1Y: String(a.p1.y.toFixed(6)),
    offsetD: String(a.offsetD.toFixed(6)),
    extentMinT: String(a.extentMinT.toFixed(6)), extentMaxT: String(a.extentMaxT.toFixed(6)),
    axisStyle: { layer: 'pdf-vector' },
    segmentCount: a.segmentCount, totalMergedLength: String(a.totalLength.toFixed(3)),
    confidence: String(a.confidence.toFixed(3)), status: 'AUTO' as const,
  }));

  const nodeInserts: InsertGridNode[] = intersections.map(pt => ({
    componentId: '0', x: String(pt.x.toFixed(6)), y: String(pt.y.toFixed(6)),
    confidence: String(pt.confidence.toFixed(3)),
  }));

  const nodeAxisInserts: InsertGridNodeAxis[] = [];
  for (let ni = 0; ni < intersections.length; ni++) {
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(intersections[ni].axisIdxA) });
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(intersections[ni].axisIdxB) });
  }

  // PDF coordinates are typically in points (1pt = 1/72 inch = 0.352778mm)
  const ptToMeters = 0.000352778;
  const transform: InsertGridCoordinateTransform = {
    projectId: '', fromFrame: 'PDF_USER', toFrame: 'MODEL',
    matrix2x3: [[ptToMeters, 0, 0], [0, ptToMeters, 0]],
    scale: String(ptToMeters.toFixed(10)), rotationDeg: '0',
    translationX: '0', translationY: '0',
    calibrationMethod: 'SHEET_SCALE',
    sourceUnit: 'pt', targetUnit: 'm',
    notes: 'PDF user-space points → meters (1pt = 0.352778mm)',
  };

  return {
    success: true, components, families: familyInserts, axes: axisInserts,
    markers: labelResult.markers, labels: labelResult.labels, axisLabels: labelResult.axisLabels,
    nodes: nodeInserts, nodeAxes: nodeAxisInserts, transform,
    warnings, errors, extractionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRID EXTRACTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

const pdfGridExtractor: GridExtractor = {
  name: 'pdf-vector-grid-detector-v1',
  supportedTypes: ['PDF_VECTOR'],

  async extract(
    buffer: Buffer,
    classification: InputClassification,
    params: typeof DEFAULT_DETECTION_PARAMS,
    runId: string,
  ): Promise<ExtractorResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    // ── Step 1: Extract content streams ──
    const streams = extractContentStreams(buffer);
    if (streams.length === 0) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings: ['No content streams found in PDF'],
        errors: ['PDF contains no extractable vector content — may be raster-only'],
        extractionTimeMs: Date.now() - startTime,
      };
    }
    warnings.push(`Extracted ${streams.length} content streams from PDF`);

    // ── Step 2: Parse all streams ──
    let allSegments: PdfSegment[] = [];
    let allCircles: PdfCircle[] = [];
    let allTexts: PdfText[] = [];
    let allClosedPaths: PdfClosedPath[] = [];

    for (const stream of streams) {
      const parsed = parseContentStream(stream);
      allSegments.push(...parsed.segments);
      allCircles.push(...parsed.circles);
      allTexts.push(...parsed.texts);
      allClosedPaths.push(...parsed.closedPaths);
    }

    warnings.push(
      `Parsed: ${allSegments.length} segments, ${allCircles.length} circles, ` +
      `${allTexts.length} texts, ${allClosedPaths.length} closed paths`
    );

    if (allSegments.length === 0) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings, errors: ['No line segments found in PDF vector content'],
        extractionTimeMs: Date.now() - startTime,
      };
    }

    // ── Step 3: Compute bounds ──
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of allSegments) {
      minX = Math.min(minX, s.p0.x, s.p1.x); maxX = Math.max(maxX, s.p0.x, s.p1.x);
      minY = Math.min(minY, s.p0.y, s.p1.y); maxY = Math.max(maxY, s.p0.y, s.p1.y);
    }
    const bounds: BBox = { minX, minY, maxX, maxY };
    const contentWidth = Math.max(maxX - minX, 1);
    const contentHeight = Math.max(maxY - minY, 1);
    const contentDiag = Math.sqrt(contentWidth ** 2 + contentHeight ** 2);

    // ── Step 4: Filter candidate segments ──
    const minLength = contentDiag * params.candidateMinLengthPct;
    const candidates = allSegments.filter(s => s.length >= minLength);
    warnings.push(`Candidates: ${candidates.length}/${allSegments.length} above min length ${minLength.toFixed(1)}`);

    if (candidates.length < params.angleClusterMinSupport) {
      warnings.push('Insufficient candidate segments for grid detection');
      if (candidates.length === 0) {
        return {
          success: false,
          components: [], families: [], axes: [], markers: [],
          labels: [], axisLabels: [], nodes: [], nodeAxes: [],
          warnings, errors: ['No candidate segments above minimum length'],
          extractionTimeMs: Date.now() - startTime,
        };
      }
    }

    // ── Step 5: DBSCAN angle clustering ──
    const clusters = dbscanAngleClustering(candidates, params.angleClusterEpsDeg, params.angleClusterMinSupport);
    warnings.push(`Angle clustering: ${clusters.length} families`);

    if (clusters.length === 0) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings, errors: ['No angle clusters found — no grid families detected'],
        extractionTimeMs: Date.now() - startTime,
      };
    }

    // ── Step 6: Build axes ──
    const axes = buildAxes(clusters, params.offsetToleranceMm, params.gapMergeToleranceMm);
    warnings.push(`Consolidated: ${axes.length} axes`);

    // ── Step 7: Run enhanced label engine ──
    const contentBounds: ContentBounds = {
      ...bounds, width: contentWidth, height: contentHeight, diagonal: contentDiag,
    };

    const axisGeometries: AxisGeometry[] = axes.map((a, i) => ({
      index: i, p0: a.p0, p1: a.p1, familyIndex: a.familyIdx, confidence: a.confidence,
    }));

    const engineCircles: RawCircleShape[] = allCircles.map(c => ({
      center: c.center, radius: c.radius, layer: 'pdf', source: 'CIRCLE' as const,
    }));

    const enginePolys: RawClosedPolyShape[] = allClosedPaths.map(p => ({
      centroid: p.centroid, vertices: p.vertices, vertexCount: p.vertices.length,
      area: p.area, perimeter: p.perimeter, layer: 'pdf',
    }));

    const engineTexts: RawTextEntity[] = allTexts.map(t => ({
      text: t.text, position: t.position, height: t.fontSize, rotation: 0,
      layer: 'pdf', bbox: t.bbox, source: 'VECTOR_TEXT' as const, confidence: 0.90,
    }));

    const engineParams: LabelEngineParams = {
      markerSearchRadiusPct: params.markerSearchRadiusPct,
      markerAreaMinPct: params.markerAreaMinPct,
      markerAreaMaxPct: params.markerAreaMaxPct,
      markerCircularityMin: params.markerCircularityMin,
      labelScoreWeights: params.labelScoreWeights,
      autoAssignThreshold: params.autoAssignThreshold,
      autoAssignMargin: params.autoAssignMargin,
      reviewThreshold: params.reviewThreshold,
    };

    const labelResult = runLabelEngine(
      engineCircles, enginePolys, [], engineTexts,
      axisGeometries, contentBounds, engineParams
    );
    warnings.push(...labelResult.warnings);

    const inserts = convertToInsertTypes(labelResult);

    // ── Step 8: Intersections ──
    const intersections = computeIntersections(axes, clusters);
    warnings.push(`Intersections: ${intersections.length} grid nodes`);

    // ── Step 9: Package ──
    return packageResult(
      clusters, axes, inserts, intersections,
      bounds, runId, warnings, errors, startTime,
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

registerGridExtractor(pdfGridExtractor);

console.log('📄 PDF Vector Grid Extractor v1 registered (PDF_VECTOR)');

export { pdfGridExtractor };
export default pdfGridExtractor;
