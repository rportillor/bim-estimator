// server/services/dxf-grid-extractor.ts
// ═══════════════════════════════════════════════════════════════════════════════
// DXF GRID LINE EXTRACTOR — v1.1 §4–§5, §13–§14
// ═══════════════════════════════════════════════════════════════════════════════
//
// Core geometry engine for extracting structural grid systems from DXF files.
//
// Pipeline (12 steps):
//   1.  Parse DXF buffer → raw entities (LINE, POLYLINE, CIRCLE, TEXT, MTEXT)
//   2.  Extract candidate line segments + filter by minimum length
//   3.  Compute segment angles in [0, 180°) canonical range
//   4.  DBSCAN angle clustering → orientation families (§4.2, §13.2)
//   5.  Offset clustering within families (perpendicular projection, §13.3)
//   6.  Segment merging — join collinear gaps within each offset group (§4.3)
//   7.  Build consolidated axes with endpoints, extent, and confidence
//   8.  Detect markers: CIRCLE entities near axis endpoints (§5.1 steps 18-19)
//   9.  Extract labels: TEXT/MTEXT near markers and endpoints (§5.1 steps 20-21)
//  10.  Score label-to-axis associations (§14 weighted scoring)
//  11.  Compute intersections: cross-family line-line (§4.4 steps 14-16)
//  12.  Build grid nodes + node-axis topology
//
// Registers with orchestrator via registerGridExtractor().
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification
// ═══════════════════════════════════════════════════════════════════════════════

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
  InsertGridMarker,
  InsertGridLabel,
  InsertGridAxisLabel,
  InsertGridNode,
  InsertGridNodeAxis,
  InsertGridCoordinateTransform,
} from '@shared/schema';

import {
  runLabelEngine,
  convertToInsertTypes,
  type RawCircleShape,
  type RawClosedPolyShape,
  type RawBlockInsert,
  type RawTextEntity,
  type AxisGeometry,
  type ContentBounds,
  type LabelEngineParams,
} from './grid-label-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Vec2 {
  x: number;
  y: number;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Raw line segment extracted from DXF */
interface RawSegment {
  p0: Vec2;
  p1: Vec2;
  length: number;
  /** Canonical angle in [0, 180) degrees */
  angleDeg: number;
  layer: string;
  lineType: string | null;
  color: number | null;
}

/** Circle entity for marker detection */
interface RawCircle {
  center: Vec2;
  radius: number;
  layer: string;
}

/** Text entity for label extraction */
interface RawText {
  text: string;
  position: Vec2;
  height: number;
  rotation: number;
  layer: string;
  bbox: BBox;
}

/** Result of DBSCAN angle clustering */
interface AngleCluster {
  medianAngleDeg: number;
  segments: RawSegment[];
}

/** Group of collinear segments at same perpendicular offset */
interface OffsetGroup {
  offsetD: number;
  segments: RawSegment[];
}

/** Consolidated axis after merging */
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
  layer: string;
  lineType: string | null;
}

/** Detected marker near an axis endpoint */
interface DetectedMarker {
  center: Vec2;
  radius: number;
  shape: 'CIRCLE' | 'BLOCK' | 'UNKNOWN';
  bbox: BBox;
  nearestAxisIdx: number | null;
  confidence: number;
}

/** Detected label text */
interface DetectedLabel {
  text: string;
  normText: string;
  position: Vec2;
  bbox: BBox;
  height: number;
  nearestMarkerIdx: number | null;
  confidence: number;
}

/** Intersection point between two axes from different families */
interface IntersectionPoint {
  x: number;
  y: number;
  axisIdxA: number;
  axisIdxB: number;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function dist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function _distSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Canonical angle of segment in [0, 180) degrees */
function canonicalAngle(p0: Vec2, p1: Vec2): number {
  let a = Math.atan2(p1.y - p0.y, p1.x - p0.x) * RAD;
  if (a < 0) a += 360;
  if (a >= 180) a -= 180;
  return a;
}

/** Angular distance in [0, 180) space, wrapping at 180 */
function angleDist(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 90) d = 180 - d;
  return d;
}

/** Unit direction vector from angle */
function dirVec(angleDeg: number): Vec2 {
  const r = angleDeg * DEG;
  return { x: Math.cos(r), y: Math.sin(r) };
}

/** Normal (perpendicular) to direction — rotate 90° CCW */
function normalVec(dir: Vec2): Vec2 {
  return { x: -dir.y, y: dir.x };
}

/** Project point onto line defined by origin + direction, return signed offset along normal */
function perpendicularOffset(point: Vec2, origin: Vec2, normal: Vec2): number {
  return (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
}

/** Project point onto line defined by origin + direction, return parametric t along direction */
function parametricT(point: Vec2, origin: Vec2, dir: Vec2): number {
  return (point.x - origin.x) * dir.x + (point.y - origin.y) * dir.y;
}

/** Line-line intersection. Returns null if parallel or degenerate. */
function lineLineIntersection(
  p0: Vec2, d0: Vec2,   // Line A: point + direction
  p1: Vec2, d1: Vec2,   // Line B: point + direction
): Vec2 | null {
  const cross = d0.x * d1.y - d0.y * d1.x;
  if (Math.abs(cross) < 1e-10) return null; // Parallel

  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const t = (dx * d1.y - dy * d1.x) / cross;

  return {
    x: p0.x + t * d0.x,
    y: p0.y + t * d0.y,
  };
}

/** Distance from point to line segment (clamped to endpoints) */
function pointToSegmentDist(pt: Vec2, s0: Vec2, s1: Vec2): number {
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return dist(pt, s0);

  let t = ((pt.x - s0.x) * dx + (pt.y - s0.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(pt, { x: s0.x + t * dx, y: s0.y + t * dy });
}

/** Median of a number array (mutates via sort) */
function _median(arr: number[]): number {
  if (arr.length === 0) return 0;
  arr.sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: DXF PARSING
// ═══════════════════════════════════════════════════════════════════════════════

interface ParsedDxf {
  segments: RawSegment[];
  circles: RawCircle[];
  texts: RawText[];
  closedPolys: ClosedPoly[];
  blockInserts: BlockInsert[];
  bounds: BBox;
  units: string;
  insunits: number;
}

/** Closed polyline for potential hex/rect marker detection */
interface ClosedPoly {
  centroid: Vec2;
  vertices: Vec2[];
  vertexCount: number;
  area: number;
  perimeter: number;
  layer: string;
}

/** Block INSERT reference (potential grid bubble with embedded text) */
interface BlockInsert {
  name: string;
  position: Vec2;
  scaleX: number;
  scaleY: number;
  rotation: number;
  layer: string;
  containsCircle: boolean;
  containsText: string | null;
  bbox: BBox | null;
}

async function parseDxfBuffer(buffer: Buffer): Promise<ParsedDxf> {
  // Dynamic import dxf-parser
  let DxfParser: any;
  try {
    DxfParser = (await import('dxf-parser')).default ?? (await import('dxf-parser'));
  } catch {
    throw new Error('dxf-parser not available — cannot extract grid from DXF');
  }

  const content = buffer.toString('utf8');
  const parser = new DxfParser();
  const dxf = parser.parseSync(content);
  if (!dxf || !dxf.entities) {
    throw new Error('DXF parse returned empty or invalid structure');
  }

  const segments: RawSegment[] = [];
  const circles: RawCircle[] = [];
  const texts: RawText[] = [];
  const closedPolys: ClosedPoly[] = [];
  const blockInserts: BlockInsert[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const entity of dxf.entities) {
    const layer = entity.layer || '0';

    switch (entity.type) {
      case 'LINE': {
        if (entity.vertices && entity.vertices.length >= 2) {
          const p0: Vec2 = { x: entity.vertices[0].x, y: entity.vertices[0].y };
          const p1: Vec2 = { x: entity.vertices[1].x, y: entity.vertices[1].y };
          const len = dist(p0, p1);
          if (len > 1e-6) {
            segments.push({
              p0, p1, length: len,
              angleDeg: canonicalAngle(p0, p1),
              layer,
              lineType: entity.lineType || null,
              color: entity.color ?? null,
            });
            updateBounds(p0);
            updateBounds(p1);
          }
        }
        break;
      }

      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (entity.vertices && entity.vertices.length >= 2) {
          const verts = entity.vertices;
          for (let i = 0; i < verts.length - 1; i++) {
            const p0: Vec2 = { x: verts[i].x, y: verts[i].y };
            const p1: Vec2 = { x: verts[i + 1].x, y: verts[i + 1].y };
            const len = dist(p0, p1);
            if (len > 1e-6) {
              segments.push({
                p0, p1, length: len,
                angleDeg: canonicalAngle(p0, p1),
                layer,
                lineType: entity.lineType || null,
                color: entity.color ?? null,
              });
              updateBounds(p0);
              updateBounds(p1);
            }
          }
          // Handle closed polylines
          if (entity.shape && verts.length >= 3) {
            const p0: Vec2 = { x: verts[verts.length - 1].x, y: verts[verts.length - 1].y };
            const p1: Vec2 = { x: verts[0].x, y: verts[0].y };
            const len = dist(p0, p1);
            if (len > 1e-6) {
              segments.push({
                p0, p1, length: len,
                angleDeg: canonicalAngle(p0, p1),
                layer,
                lineType: entity.lineType || null,
                color: entity.color ?? null,
              });
            }
          }
        }
        break;
      }

      case 'CIRCLE': {
        if (entity.center && entity.radius > 0) {
          const center: Vec2 = { x: entity.center.x, y: entity.center.y };
          circles.push({ center, radius: entity.radius, layer });
          updateBounds({ x: center.x - entity.radius, y: center.y - entity.radius });
          updateBounds({ x: center.x + entity.radius, y: center.y + entity.radius });
        }
        break;
      }

      case 'TEXT':
      case 'MTEXT': {
        const textVal = entity.text || '';
        if (textVal.trim() && entity.startPoint) {
          const pos: Vec2 = { x: entity.startPoint.x, y: entity.startPoint.y };
          const h = entity.textHeight || 10;
          const rot = entity.rotation || 0;
          // Approximate text bounding box
          const w = textVal.length * h * 0.6;
          const bbox: BBox = {
            minX: pos.x,
            minY: pos.y,
            maxX: pos.x + w * Math.cos(rot * DEG) + h * Math.sin(rot * DEG),
            maxY: pos.y + w * Math.sin(rot * DEG) + h * Math.cos(rot * DEG),
          };
          texts.push({ text: textVal, position: pos, height: h, rotation: rot, layer, bbox });
          updateBounds(pos);
        }
        break;
      }

      case 'INSERT': {
        // Block INSERT — potential grid bubble with embedded text
        const pos: Vec2 = {
          x: entity.position?.x ?? entity.x ?? 0,
          y: entity.position?.y ?? entity.y ?? 0,
        };
        const blockName = entity.name || entity.block || '';

        // Probe block definition for circle/text content
        let containsCircle = false;
        let containsText: string | null = null;
        let blockBbox: BBox | null = null;

        if (dxf.blocks && dxf.blocks[blockName]) {
          const blockDef = dxf.blocks[blockName];
          const blockEnts = blockDef.entities || [];
          for (const be of blockEnts) {
            if (be.type === 'CIRCLE') containsCircle = true;
            if ((be.type === 'TEXT' || be.type === 'MTEXT') && be.text) {
              containsText = be.text;
            }
          }
          // Compute block bbox from entities
          if (blockEnts.length > 0) {
            let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
            for (const be of blockEnts) {
              if (be.center) {
                const r = be.radius || 0;
                bMinX = Math.min(bMinX, be.center.x - r);
                bMinY = Math.min(bMinY, be.center.y - r);
                bMaxX = Math.max(bMaxX, be.center.x + r);
                bMaxY = Math.max(bMaxY, be.center.y + r);
              }
              if (be.vertices) {
                for (const v of be.vertices) {
                  bMinX = Math.min(bMinX, v.x);
                  bMinY = Math.min(bMinY, v.y);
                  bMaxX = Math.max(bMaxX, v.x);
                  bMaxY = Math.max(bMaxY, v.y);
                }
              }
            }
            if (isFinite(bMinX)) {
              const sx = entity.xScale || 1;
              const sy = entity.yScale || 1;
              blockBbox = {
                minX: pos.x + bMinX * sx,
                minY: pos.y + bMinY * sy,
                maxX: pos.x + bMaxX * sx,
                maxY: pos.y + bMaxY * sy,
              };
            }
          }
        }

        blockInserts.push({
          name: blockName,
          position: pos,
          scaleX: entity.xScale || 1,
          scaleY: entity.yScale || 1,
          rotation: entity.rotation || 0,
          layer,
          containsCircle,
          containsText,
          bbox: blockBbox,
        });
        updateBounds(pos);
        break;
      }

      case 'ARC': {
        // ARC entities near axis endpoints could be marker arcs
        if (entity.center && entity.radius > 0) {
          const center: Vec2 = { x: entity.center.x, y: entity.center.y };
          // Treat arcs with large sweep (>= 270°) as circles for marker detection
          const startAngle = entity.startAngle || 0;
          const endAngle = entity.endAngle || 360;
          let sweep = endAngle - startAngle;
          if (sweep < 0) sweep += 360;
          if (sweep >= 270) {
            circles.push({ center, radius: entity.radius, layer });
          }
          updateBounds({ x: center.x - entity.radius, y: center.y - entity.radius });
          updateBounds({ x: center.x + entity.radius, y: center.y + entity.radius });
        }
        break;
      }
    }
  }

  // ── Post-processing: detect closed polylines as potential markers ──
  // Re-scan entities for closed polylines we already extracted as segments
  if (dxf.entities) {
    for (const entity of dxf.entities) {
      if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') &&
          entity.shape && entity.vertices && entity.vertices.length >= 3) {
        const verts: Vec2[] = entity.vertices.map((v: any) => ({ x: v.x, y: v.y }));
        const n = verts.length;

        // Compute centroid
        let cx = 0, cy = 0;
        for (const v of verts) { cx += v.x; cy += v.y; }
        cx /= n; cy /= n;

        // Compute area (shoelace formula)
        let area = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
        }
        area = Math.abs(area) / 2;

        // Compute perimeter
        let perimeter = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          perimeter += dist(verts[i], verts[j]);
        }

        closedPolys.push({
          centroid: { x: cx, y: cy },
          vertices: verts,
          vertexCount: n,
          area,
          perimeter,
          layer: entity.layer || '0',
        });
      }
    }
  }

  function updateBounds(p: Vec2) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Extract INSUNITS from header
  const insunits = dxf.header?.$INSUNITS?.value ?? 0;
  const UNIT_MAP: Record<number, string> = {
    0: 'Unitless', 1: 'Inches', 2: 'Feet', 3: 'Miles',
    4: 'Millimeters', 5: 'Centimeters', 6: 'Meters',
  };

  return {
    segments,
    circles,
    texts,
    closedPolys,
    blockInserts,
    bounds: { minX, minY, maxX, maxY },
    units: UNIT_MAP[insunits] || 'Unknown',
    insunits,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: CANDIDATE FILTERING — v1.1 §13.1
// ═══════════════════════════════════════════════════════════════════════════════

function filterCandidateSegments(
  segments: RawSegment[],
  bounds: BBox,
  params: typeof DEFAULT_DETECTION_PARAMS,
  detectedGridLayers: string[] | undefined,
): { candidates: RawSegment[]; notes: string[] } {
  const notes: string[] = [];
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const contentDiag = Math.sqrt(contentWidth * contentWidth + contentHeight * contentHeight);
  const minLength = contentDiag * params.candidateMinLengthPct;

  notes.push(`Content diagonal: ${contentDiag.toFixed(1)}, min segment length: ${minLength.toFixed(1)}`);

  // If grid layers are known, prioritize them
  const gridLayerPattern = /grid|axis|grille|g-grid|a-grid|s-grid|struct/i;
  const hasKnownGridLayers = detectedGridLayers && detectedGridLayers.some(l => gridLayerPattern.test(l));

  let candidates: RawSegment[];

  if (hasKnownGridLayers) {
    // First try: only segments on grid-named layers
    const gridLayers = new Set(detectedGridLayers!.filter(l => gridLayerPattern.test(l)));
    candidates = segments.filter(s =>
      gridLayers.has(s.layer) && s.length >= minLength
    );
    notes.push(`Grid layers detected: ${Array.from(gridLayers).join(', ')}, candidates: ${candidates.length}`);

    // If too few, widen to all layers
    if (candidates.length < params.angleClusterMinSupport * 2) {
      candidates = segments.filter(s => s.length >= minLength);
      notes.push(`Widened to all layers: ${candidates.length} candidates`);
    }
  } else {
    // No grid layers known — use all segments above threshold
    candidates = segments.filter(s => s.length >= minLength);
    notes.push(`No grid layers detected, using ${candidates.length}/${segments.length} segments above min length`);
  }

  return { candidates, notes };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: DBSCAN ANGLE CLUSTERING — v1.1 §4.2, §13.2
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DBSCAN clustering on 1D angular data in [0, 180°) with wraparound.
 *
 * Returns clusters of approximately parallel segments. Noise points are
 * discarded (not grid candidates).
 */
function dbscanAngleClustering(
  segments: RawSegment[],
  epsDeg: number,
  minSupport: number,
): AngleCluster[] {
  const n = segments.length;
  if (n === 0) return [];

  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array<number>(n).fill(UNVISITED);
  let clusterId = 0;

  // Precompute angle-based neighbor lists
  function regionQuery(idx: number): number[] {
    const neighbors: number[] = [];
    const a = segments[idx].angleDeg;
    for (let j = 0; j < n; j++) {
      if (angleDist(a, segments[j].angleDeg) <= epsDeg) {
        neighbors.push(j);
      }
    }
    return neighbors;
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = regionQuery(i);
    if (neighbors.length < minSupport) {
      labels[i] = NOISE;
      continue;
    }

    // Start new cluster
    labels[i] = clusterId;
    const seed = [...neighbors];
    const visited = new Set<number>([i]);

    while (seed.length > 0) {
      const q = seed.pop()!;
      if (visited.has(q)) continue;
      visited.add(q);

      if (labels[q] === NOISE) labels[q] = clusterId;
      if (labels[q] !== UNVISITED) continue;

      labels[q] = clusterId;
      const qNeighbors = regionQuery(q);
      if (qNeighbors.length >= minSupport) {
        for (const nn of qNeighbors) {
          if (!visited.has(nn)) seed.push(nn);
        }
      }
    }

    clusterId++;
  }

  // Collect clusters
  const clusters = new Map<number, RawSegment[]>();
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      if (!clusters.has(labels[i])) clusters.set(labels[i], []);
      clusters.get(labels[i])!.push(segments[i]);
    }
  }

  // Build result with representative angle per cluster
  const result: AngleCluster[] = [];
  for (const [, segs] of clusters) {
    // Use circular median for angular data to handle wraparound
    const angles = segs.map(s => s.angleDeg);
    const medAngle = circularMedianAngle(angles);
    result.push({ medianAngleDeg: medAngle, segments: segs });
  }

  // Sort by total segment length (dominance)
  result.sort((a, b) => {
    const lenA = a.segments.reduce((s, seg) => s + seg.length, 0);
    const lenB = b.segments.reduce((s, seg) => s + seg.length, 0);
    return lenB - lenA;
  });

  return result;
}

/**
 * Circular median angle in [0, 180) space.
 * Handles wraparound correctly (e.g., angles near 0° and 179°).
 */
function circularMedianAngle(angles: number[]): number {
  if (angles.length === 0) return 0;
  if (angles.length === 1) return angles[0];

  // Find the angle that minimizes total angular distance
  let bestAngle = angles[0];
  let bestSum = Infinity;

  for (const candidate of angles) {
    let sum = 0;
    for (const a of angles) {
      sum += angleDist(candidate, a);
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestAngle = candidate;
    }
  }

  return bestAngle;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: OFFSET CLUSTERING — v1.1 §4.3, §13.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cluster segments within a family by their perpendicular offset from
 * the family reference line (passing through centroid with family direction).
 *
 * Segments with similar offsets are on the same grid line.
 */
function clusterByOffset(
  cluster: AngleCluster,
  offsetTolerance: number,
): OffsetGroup[] {
  const dir = dirVec(cluster.medianAngleDeg);
  const norm = normalVec(dir);

  // Use centroid of all segment midpoints as reference origin
  let cx = 0, cy = 0;
  for (const seg of cluster.segments) {
    cx += (seg.p0.x + seg.p1.x) / 2;
    cy += (seg.p0.y + seg.p1.y) / 2;
  }
  cx /= cluster.segments.length;
  cy /= cluster.segments.length;
  const origin: Vec2 = { x: cx, y: cy };

  // Compute offset for each segment (average of endpoint offsets)
  const segWithOffset = cluster.segments.map(seg => {
    const d0 = perpendicularOffset(seg.p0, origin, norm);
    const d1 = perpendicularOffset(seg.p1, origin, norm);
    return { seg, offset: (d0 + d1) / 2 };
  });

  // Sort by offset
  segWithOffset.sort((a, b) => a.offset - b.offset);

  // Greedy 1D clustering
  const groups: OffsetGroup[] = [];
  let currentGroup: OffsetGroup | null = null;

  for (const item of segWithOffset) {
    if (!currentGroup || Math.abs(item.offset - currentGroup.offsetD) > offsetTolerance) {
      // Start new group
      currentGroup = { offsetD: item.offset, segments: [item.seg] };
      groups.push(currentGroup);
    } else {
      currentGroup.segments.push(item.seg);
      // Update group offset to running average
      const n = currentGroup.segments.length;
      currentGroup.offsetD = currentGroup.offsetD * (n - 1) / n + item.offset / n;
    }
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: SEGMENT MERGING — v1.1 §4.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge collinear segments within an offset group into a single consolidated axis.
 * Handles gaps between segments up to gapTolerance.
 */
function mergeSegments(
  group: OffsetGroup,
  familyAngleDeg: number,
  gapTolerance: number,
): { p0: Vec2; p1: Vec2; segmentCount: number; totalLength: number } {
  const dir = dirVec(familyAngleDeg);
  const norm = normalVec(dir);

  // Project all endpoints onto the family direction line
  // Use group centroid as origin
  let cx = 0, cy = 0;
  for (const seg of group.segments) {
    cx += (seg.p0.x + seg.p1.x) / 2;
    cy += (seg.p0.y + seg.p1.y) / 2;
  }
  cx /= group.segments.length;
  cy /= group.segments.length;
  const origin: Vec2 = { x: cx, y: cy };

  // Get parametric intervals [tMin, tMax] for each segment
  const intervals: Array<[number, number]> = [];
  let totalLength = 0;

  for (const seg of group.segments) {
    const t0 = parametricT(seg.p0, origin, dir);
    const t1 = parametricT(seg.p1, origin, dir);
    intervals.push([Math.min(t0, t1), Math.max(t0, t1)]);
    totalLength += seg.length;
  }

  // Sort intervals by start
  intervals.sort((a, b) => a[0] - b[0]);

  // Merge overlapping/touching intervals (with gap tolerance)
  const merged: Array<[number, number]> = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i][0] <= last[1] + gapTolerance) {
      last[1] = Math.max(last[1], intervals[i][1]);
    } else {
      merged.push(intervals[i]);
    }
  }

  // Use the longest merged interval as the axis extent
  let bestInterval = merged[0];
  for (const iv of merged) {
    if ((iv[1] - iv[0]) > (bestInterval[1] - bestInterval[0])) {
      bestInterval = iv;
    }
  }

  // Also compute the offset-averaged position perpendicular to the line
  const avgOffset = group.segments.reduce((sum, seg) => {
    return sum + perpendicularOffset(
      { x: (seg.p0.x + seg.p1.x) / 2, y: (seg.p0.y + seg.p1.y) / 2 },
      origin, norm
    );
  }, 0) / group.segments.length;

  // Reconstruct endpoints from parametric extent + offset
  const p0: Vec2 = {
    x: origin.x + dir.x * bestInterval[0] + norm.x * avgOffset,
    y: origin.y + dir.y * bestInterval[0] + norm.y * avgOffset,
  };
  const p1: Vec2 = {
    x: origin.x + dir.x * bestInterval[1] + norm.x * avgOffset,
    y: origin.y + dir.y * bestInterval[1] + norm.y * avgOffset,
  };

  return {
    p0, p1,
    segmentCount: group.segments.length,
    totalLength,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS 6-7: BUILD CONSOLIDATED AXES
// ═══════════════════════════════════════════════════════════════════════════════

function buildConsolidatedAxes(
  clusters: AngleCluster[],
  params: typeof DEFAULT_DETECTION_PARAMS,
): { families: AngleCluster[]; axes: MergedAxis[] } {
  const allAxes: MergedAxis[] = [];

  for (let fi = 0; fi < clusters.length; fi++) {
    const cluster = clusters[fi];
    const groups = clusterByOffset(cluster, params.offsetToleranceMm);

    for (const group of groups) {
      if (group.segments.length === 0) continue;

      const merged = mergeSegments(group, cluster.medianAngleDeg, params.gapMergeToleranceMm);
      const axisLength = dist(merged.p0, merged.p1);

      // Confidence based on:
      //   - segment count (more segments = more confident)
      //   - total merged length vs individual lengths
      //   - axis length relative to content
      const segConf = Math.min(1.0, merged.segmentCount / 3);
      const lenConf = Math.min(1.0, axisLength / 1000); // Normalize to 1m
      const confidence = 0.6 * segConf + 0.4 * lenConf;

      // Get dominant layer/lineType from segments
      const layerCounts = new Map<string, number>();
      for (const seg of group.segments) {
        layerCounts.set(seg.layer, (layerCounts.get(seg.layer) || 0) + seg.length);
      }
      let bestLayer = '0';
      let bestLen = 0;
      for (const [layer, len] of layerCounts) {
        if (len > bestLen) { bestLayer = layer; bestLen = len; }
      }

      const dir = dirVec(cluster.medianAngleDeg);
      const origin = merged.p0;
      const extMinT = parametricT(merged.p0, origin, dir);
      const extMaxT = parametricT(merged.p1, origin, dir);

      allAxes.push({
        familyIdx: fi,
        p0: merged.p0,
        p1: merged.p1,
        offsetD: group.offsetD,
        extentMinT: Math.min(extMinT, extMaxT),
        extentMaxT: Math.max(extMinT, extMaxT),
        segmentCount: merged.segmentCount,
        totalLength: merged.totalLength,
        confidence: Math.min(0.999, Math.max(0.1, confidence)),
        layer: bestLayer,
        lineType: group.segments[0]?.lineType ?? null,
      });
    }
  }

  return { families: clusters, axes: allAxes };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8: MARKER DETECTION — v1.1 §5.1 steps 18-19
// ═══════════════════════════════════════════════════════════════════════════════

function _detectMarkers(
  circles: RawCircle[],
  axes: MergedAxis[],
  bounds: BBox,
  params: typeof DEFAULT_DETECTION_PARAMS,
): DetectedMarker[] {
  const markers: DetectedMarker[] = [];
  const contentArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  const diag = Math.sqrt(
    (bounds.maxX - bounds.minX) ** 2 + (bounds.maxY - bounds.minY) ** 2
  );
  const searchRadius = diag * params.markerSearchRadiusPct;

  if (contentArea <= 0) return markers;

  for (const circle of circles) {
    const circleArea = Math.PI * circle.radius * circle.radius;
    const areaPct = circleArea / contentArea;

    // Filter by area
    if (areaPct < params.markerAreaMinPct || areaPct > params.markerAreaMaxPct) continue;

    // Find nearest axis endpoint
    let nearestAxisIdx: number | null = null;
    let nearestDist = Infinity;

    for (let ai = 0; ai < axes.length; ai++) {
      const d0 = dist(circle.center, axes[ai].p0);
      const d1 = dist(circle.center, axes[ai].p1);
      const dMin = Math.min(d0, d1);
      if (dMin < nearestDist) {
        nearestDist = dMin;
        nearestAxisIdx = ai;
      }
    }

    // Only accept markers within search radius of an axis endpoint
    if (nearestDist > searchRadius && axes.length > 0) continue;

    const conf = nearestAxisIdx !== null
      ? Math.max(0.5, 1.0 - nearestDist / searchRadius)
      : 0.4;

    markers.push({
      center: circle.center,
      radius: circle.radius,
      shape: 'CIRCLE',
      bbox: {
        minX: circle.center.x - circle.radius,
        minY: circle.center.y - circle.radius,
        maxX: circle.center.x + circle.radius,
        maxY: circle.center.y + circle.radius,
      },
      nearestAxisIdx,
      confidence: Math.min(0.999, conf),
    });
  }

  return markers;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9: LABEL EXTRACTION — v1.1 §5.1 steps 20-21
// ═══════════════════════════════════════════════════════════════════════════════

/** Normalize grid label text: trim, uppercase, fix common OCR confusion */
function normalizeGridLabel(raw: string): string {
  let norm = raw.trim().toUpperCase();
  // Strip common prefixes that aren't part of the label
  norm = norm.replace(/^GRID\s*/i, '');
  // Common grid label patterns: single letter, number, or letter-number combo
  // Keep only the essential part
  norm = norm.replace(/\s+/g, '');
  return norm;
}

/** Check if text looks like a grid label */
function isGridLabelCandidate(text: string): boolean {
  const norm = normalizeGridLabel(text);
  if (norm.length === 0 || norm.length > 5) return false;

  // Grid labels are typically: A, B, C, ... / 1, 2, 3, ... / A1, B-2, G.3
  return /^[A-Z]{1,2}$/.test(norm) ||           // Letter(s)
         /^\d{1,3}$/.test(norm) ||               // Number(s)
         /^[A-Z]\d{1,2}$/.test(norm) ||          // Letter+Number
         /^[A-Z][-.]?\d{1,2}$/.test(norm) ||     // Letter-Number
         /^\d{1,2}[-.]?[A-Z]$/.test(norm);       // Number-Letter
}

function _extractLabels(
  texts: RawText[],
  markers: DetectedMarker[],
  axes: MergedAxis[],
  bounds: BBox,
): DetectedLabel[] {
  const labels: DetectedLabel[] = [];
  const diag = Math.sqrt(
    (bounds.maxX - bounds.minX) ** 2 + (bounds.maxY - bounds.minY) ** 2
  );
  // Search radius for text near markers/endpoints
  const textSearchRadius = diag * 0.025;

  for (const text of texts) {
    if (!isGridLabelCandidate(text.text)) continue;

    const norm = normalizeGridLabel(text.text);

    // Find nearest marker
    let nearestMarkerIdx: number | null = null;
    let nearestMarkerDist = Infinity;
    for (let mi = 0; mi < markers.length; mi++) {
      const d = dist(text.position, markers[mi].center);
      if (d < nearestMarkerDist) {
        nearestMarkerDist = d;
        nearestMarkerIdx = mi;
      }
    }

    // Check if text is inside or near a marker
    const insideMarker = nearestMarkerIdx !== null &&
      nearestMarkerDist <= markers[nearestMarkerIdx!].radius * 1.5;

    // Also check proximity to axis endpoints
    let nearAxisEndpoint = false;
    for (const axis of axes) {
      if (dist(text.position, axis.p0) < textSearchRadius ||
          dist(text.position, axis.p1) < textSearchRadius) {
        nearAxisEndpoint = true;
        break;
      }
    }

    // Only accept labels that are near a marker or axis endpoint
    if (!insideMarker && !nearAxisEndpoint && nearestMarkerDist > textSearchRadius) continue;

    const confidence = insideMarker ? 0.95 : (nearAxisEndpoint ? 0.80 : 0.60);

    labels.push({
      text: text.text,
      normText: norm,
      position: text.position,
      bbox: text.bbox,
      height: text.height,
      nearestMarkerIdx: insideMarker ? nearestMarkerIdx : null,
      confidence: Math.min(0.999, confidence),
    });
  }

  return labels;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10: LABEL-AXIS SCORING — v1.1 §14
// ═══════════════════════════════════════════════════════════════════════════════

interface ScoredAssociation {
  axisIdx: number;
  labelIdx: number;
  scoreTotal: number;
  scoreBreakdown: {
    endpointProximity: number;
    perpendicularDistance: number;
    directionalAlignment: number;
    markerSupport: number;
    textQuality: number;
  };
  associationType: 'END_LABEL' | 'MID_LABEL' | 'MARKER_LABEL';
  status: 'AUTO' | 'NEEDS_REVIEW';
}

function _scoreLabelAxisAssociations(
  axes: MergedAxis[],
  labels: DetectedLabel[],
  markers: DetectedMarker[],
  params: typeof DEFAULT_DETECTION_PARAMS,
  bounds: BBox,
): ScoredAssociation[] {
  const associations: ScoredAssociation[] = [];
  const diag = Math.sqrt(
    (bounds.maxX - bounds.minX) ** 2 + (bounds.maxY - bounds.minY) ** 2
  );
  const refDist = diag * 0.05; // Reference distance for scoring normalization
  const weights = params.labelScoreWeights;

  for (let li = 0; li < labels.length; li++) {
    const label = labels[li];
    const scores: Array<{ axisIdx: number; total: number; breakdown: any; assocType: any }> = [];

    for (let ai = 0; ai < axes.length; ai++) {
      const axis = axes[ai];

      // S_end: endpoint proximity (closest endpoint)
      const dEnd = Math.min(dist(label.position, axis.p0), dist(label.position, axis.p1));
      const sEnd = Math.max(0, 1 - dEnd / refDist);

      // S_perp: perpendicular distance to axis line
      const dPerp = pointToSegmentDist(label.position, axis.p0, axis.p1);
      const sPerp = Math.max(0, 1 - dPerp / refDist);

      // S_align: directional alignment (label near axis extension, not perpendicular)
      const axisDir = dirVec(canonicalAngle(axis.p0, axis.p1));
      const labelDir = {
        x: label.position.x - (axis.p0.x + axis.p1.x) / 2,
        y: label.position.y - (axis.p0.y + axis.p1.y) / 2,
      };
      const labelDirLen = Math.sqrt(labelDir.x ** 2 + labelDir.y ** 2);
      let sAlign = 0.5;
      if (labelDirLen > 1e-6) {
        const dotProduct = Math.abs(
          (labelDir.x / labelDirLen) * axisDir.x +
          (labelDir.y / labelDirLen) * axisDir.y
        );
        // Higher dot product = label is along the axis direction (endpoint label)
        // Lower = label is perpendicular (mid-span label, less likely for grid)
        sAlign = dotProduct;
      }

      // S_mark: marker support (does a marker connect this label to this axis?)
      let sMark = 0;
      if (label.nearestMarkerIdx !== null) {
        const marker = markers[label.nearestMarkerIdx];
        if (marker.nearestAxisIdx === ai) {
          sMark = 1.0; // Direct marker link
        } else {
          // Marker exists but associated with different axis
          sMark = 0.2;
        }
      }

      // S_text: text quality
      const sText = label.confidence;

      // Weighted total
      const total =
        weights.endpointProximity * sEnd +
        weights.perpendicularDistance * sPerp +
        weights.directionalAlignment * sAlign +
        weights.markerSupport * sMark +
        weights.textQuality * sText;

      // Determine association type
      let assocType: 'END_LABEL' | 'MID_LABEL' | 'MARKER_LABEL' = 'END_LABEL';
      if (sMark >= 0.8) assocType = 'MARKER_LABEL';
      else if (sAlign < 0.5) assocType = 'MID_LABEL';

      scores.push({
        axisIdx: ai,
        total,
        breakdown: {
          endpointProximity: Number(sEnd.toFixed(3)),
          perpendicularDistance: Number(sPerp.toFixed(3)),
          directionalAlignment: Number(sAlign.toFixed(3)),
          markerSupport: Number(sMark.toFixed(3)),
          textQuality: Number(sText.toFixed(3)),
        },
        assocType,
      });
    }

    // Sort by score descending
    scores.sort((a, b) => b.total - a.total);

    // Take the best match if above threshold
    if (scores.length > 0 && scores[0].total >= params.reviewThreshold) {
      const best = scores[0];
      const margin = scores.length > 1 ? best.total - scores[1].total : 1.0;

      let status: 'AUTO' | 'NEEDS_REVIEW' = 'NEEDS_REVIEW';
      if (best.total >= params.autoAssignThreshold && margin >= params.autoAssignMargin) {
        status = 'AUTO';
      }

      associations.push({
        axisIdx: best.axisIdx,
        labelIdx: li,
        scoreTotal: Number(best.total.toFixed(3)),
        scoreBreakdown: best.breakdown,
        associationType: best.assocType,
        status,
      });
    }
  }

  return associations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11: INTERSECTION GRAPH — v1.1 §4.4 steps 14-16
// ═══════════════════════════════════════════════════════════════════════════════

function computeIntersections(
  axes: MergedAxis[],
  families: AngleCluster[],
): IntersectionPoint[] {
  const intersections: IntersectionPoint[] = [];
  const MIN_ANGLE_DIFF = 10; // Minimum angle difference between families (degrees)

  for (let i = 0; i < axes.length; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      // Only intersect axes from DIFFERENT families
      if (axes[i].familyIdx === axes[j].familyIdx) continue;

      // Check families have sufficient angular difference
      const fA = families[axes[i].familyIdx];
      const fB = families[axes[j].familyIdx];
      if (angleDist(fA.medianAngleDeg, fB.medianAngleDeg) < MIN_ANGLE_DIFF) continue;

      const dirA = dirVec(fA.medianAngleDeg);
      const dirB = dirVec(fB.medianAngleDeg);

      const pt = lineLineIntersection(axes[i].p0, dirA, axes[j].p0, dirB);
      if (!pt) continue;

      // Check intersection is within or near both axes' extents
      const dA = Math.min(
        pointToSegmentDist(pt, axes[i].p0, axes[i].p1),
        dist(pt, axes[i].p0),
        dist(pt, axes[i].p1)
      );
      const dB = Math.min(
        pointToSegmentDist(pt, axes[j].p0, axes[j].p1),
        dist(pt, axes[j].p0),
        dist(pt, axes[j].p1)
      );

      // Allow some extension beyond axis endpoints (grid lines often extend)
      const extTol = Math.max(
        dist(axes[i].p0, axes[i].p1) * 0.15,
        dist(axes[j].p0, axes[j].p1) * 0.15,
        100 // minimum tolerance
      );

      if (dA > extTol || dB > extTol) continue;

      const conf = Math.min(axes[i].confidence, axes[j].confidence) *
        Math.max(0.5, 1.0 - (dA + dB) / (2 * extTol));

      intersections.push({
        x: pt.x,
        y: pt.y,
        axisIdxA: i,
        axisIdxB: j,
        confidence: Math.min(0.999, Math.max(0.1, conf)),
      });
    }
  }

  // Deduplicate intersections that are very close together
  const deduped: IntersectionPoint[] = [];
  const MERGE_DIST = 50; // units in file coordinates
  for (const pt of intersections) {
    const existing = deduped.find(d =>
      Math.abs(d.x - pt.x) < MERGE_DIST && Math.abs(d.y - pt.y) < MERGE_DIST
    );
    if (!existing) {
      deduped.push(pt);
    } else if (pt.confidence > existing.confidence) {
      // Keep higher confidence
      Object.assign(existing, pt);
    }
  }

  return deduped;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12: PACKAGE AS ExtractorResult
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Unit scale factor to convert file coordinates to meters.
 */
function unitScaleToMeters(insunits: number): number {
  switch (insunits) {
    case 1: return 0.0254;        // Inches
    case 2: return 0.3048;        // Feet
    case 4: return 0.001;         // Millimeters
    case 5: return 0.01;          // Centimeters
    case 6: return 1.0;           // Meters
    default: return 0.001;        // Default to mm (most common in construction)
  }
}

function _packageExtractorResult(
  families: AngleCluster[],
  axes: MergedAxis[],
  markers: DetectedMarker[],
  labels: DetectedLabel[],
  associations: ScoredAssociation[],
  intersections: IntersectionPoint[],
  bounds: BBox,
  insunits: number,
  units: string,
  runId: string,
  warnings: string[],
  errors: string[],
  startTime: number,
): ExtractorResult {
  // ── Component (one per DXF file) ──
  const components: InsertGridComponent[] = [{
    runId,  // Will be set by persist function
    name: 'Main',
    bboxMinX: String(bounds.minX),
    bboxMinY: String(bounds.minY),
    bboxMaxX: String(bounds.maxX),
    bboxMaxY: String(bounds.maxY),
    primaryFrame: 'MODEL',
    confidence: String(Math.min(0.999, 0.5 + families.length * 0.15).toFixed(3)),
  }];

  // ── Families ──
  const familyInserts: InsertGridFamily[] = families.map((cluster, fi) => {
    const dir = dirVec(cluster.medianAngleDeg);
    const norm = normalVec(dir);
    const totalLen = cluster.segments.reduce((s, seg) => s + seg.length, 0);
    const conf = Math.min(0.999, 0.6 + Math.min(0.35, totalLen / 10000));

    return {
      componentId: '0', // temp ref → components[0]
      thetaDeg: String(cluster.medianAngleDeg.toFixed(4)),
      directionVecX: String(dir.x.toFixed(8)),
      directionVecY: String(dir.y.toFixed(8)),
      normalVecX: String(norm.x.toFixed(8)),
      normalVecY: String(norm.y.toFixed(8)),
      familyRank: fi + 1,
      confidence: String(conf.toFixed(3)),
    };
  });

  // ── Axes ──
  const axisInserts: InsertGridAxis[] = axes.map(axis => ({
    familyId: String(axis.familyIdx), // temp ref → families[familyIdx]
    geometryType: 'LINE' as const,
    p0X: String(axis.p0.x.toFixed(6)),
    p0Y: String(axis.p0.y.toFixed(6)),
    p1X: String(axis.p1.x.toFixed(6)),
    p1Y: String(axis.p1.y.toFixed(6)),
    offsetD: String(axis.offsetD.toFixed(6)),
    extentMinT: String(axis.extentMinT.toFixed(6)),
    extentMaxT: String(axis.extentMaxT.toFixed(6)),
    axisStyle: {
      layer: axis.layer,
      linetype: axis.lineType,
    },
    segmentCount: axis.segmentCount,
    totalMergedLength: String(axis.totalLength.toFixed(3)),
    confidence: String(axis.confidence.toFixed(3)),
    status: 'AUTO' as const,
  }));

  // ── Markers ──
  const markerInserts: InsertGridMarker[] = markers.map(marker => ({
    axisId: marker.nearestAxisIdx !== null ? String(marker.nearestAxisIdx) : null,
    markerShape: marker.shape as any,
    centerX: String(marker.center.x.toFixed(6)),
    centerY: String(marker.center.y.toFixed(6)),
    bbox: marker.bbox,
    confidence: String(marker.confidence.toFixed(3)),
  }));

  // ── Labels ──
  const labelInserts: InsertGridLabel[] = labels.map(label => ({
    markerId: label.nearestMarkerIdx !== null ? String(label.nearestMarkerIdx) : null,
    rawText: label.text,
    normText: label.normText,
    textSource: 'VECTOR_TEXT' as const,
    textConfidence: String(label.confidence.toFixed(3)),
    bbox: label.bbox,
  }));

  // ── Axis-Label Associations ──
  const axisLabelInserts: InsertGridAxisLabel[] = associations.map(assoc => ({
    axisId: String(assoc.axisIdx),   // temp ref → axes[axisIdx]
    labelId: String(assoc.labelIdx), // temp ref → labels[labelIdx]
    scoreTotal: String(assoc.scoreTotal.toFixed(3)),
    scoreBreakdown: assoc.scoreBreakdown,
    associationType: assoc.associationType as any,
    status: assoc.status as any,
  }));

  // ── Nodes ──
  const nodeInserts: InsertGridNode[] = intersections.map(pt => ({
    componentId: '0', // temp ref → components[0]
    x: String(pt.x.toFixed(6)),
    y: String(pt.y.toFixed(6)),
    confidence: String(pt.confidence.toFixed(3)),
  }));

  // ── Node-Axis Links ──
  const nodeAxisInserts: InsertGridNodeAxis[] = [];
  for (let ni = 0; ni < intersections.length; ni++) {
    const pt = intersections[ni];
    nodeAxisInserts.push({
      nodeId: String(ni),             // temp ref → nodes[ni]
      axisId: String(pt.axisIdxA),    // temp ref → axes[axisIdxA]
    });
    nodeAxisInserts.push({
      nodeId: String(ni),
      axisId: String(pt.axisIdxB),
    });
  }

  // ── Coordinate Transform ──
  const scale = unitScaleToMeters(insunits);
  const transform: InsertGridCoordinateTransform | undefined =
    scale !== 1.0 ? {
      projectId: '', // Will be set by persist function
      fromFrame: 'MODEL',
      toFrame: 'MODEL',
      matrix2x3: [[scale, 0, 0], [0, scale, 0]],
      scale: String(scale.toFixed(10)),
      rotationDeg: '0',
      translationX: '0',
      translationY: '0',
      calibrationMethod: 'CAD_UNITS',
      sourceUnit: units.toLowerCase(),
      targetUnit: 'm',
      notes: `DXF INSUNITS=${insunits} → meters (×${scale})`,
    } : undefined;

  return {
    success: true,
    components,
    families: familyInserts,
    axes: axisInserts,
    markers: markerInserts,
    labels: labelInserts,
    axisLabels: axisLabelInserts,
    nodes: nodeInserts,
    nodeAxes: nodeAxisInserts,
    transform,
    warnings,
    errors,
    extractionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRID EXTRACTOR — Main Implementation
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12 (ENHANCED): PACKAGE ExtractorResult FROM LABEL ENGINE OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Package ExtractorResult using pre-built InsertGrid* types from the label engine.
 * Unlike the basic packageExtractorResult, this receives markers/labels/axisLabels
 * already in Insert format with index-based temp FK refs.
 */
function packageExtractorResultEnhanced(
  families: AngleCluster[],
  axes: MergedAxis[],
  markerInserts: InsertGridMarker[],
  labelInserts: InsertGridLabel[],
  axisLabelInserts: InsertGridAxisLabel[],
  intersections: IntersectionPoint[],
  bounds: BBox,
  insunits: number,
  units: string,
  runId: string,
  warnings: string[],
  errors: string[],
  startTime: number,
): ExtractorResult {
  // ── Component ──
  const components: InsertGridComponent[] = [{
    runId,
    name: 'Main',
    bboxMinX: String(bounds.minX),
    bboxMinY: String(bounds.minY),
    bboxMaxX: String(bounds.maxX),
    bboxMaxY: String(bounds.maxY),
    primaryFrame: 'MODEL',
    confidence: String(Math.min(0.999, 0.5 + families.length * 0.15).toFixed(3)),
  }];

  // ── Families ──
  const familyInserts: InsertGridFamily[] = families.map((cluster, fi) => {
    const dir = dirVec(cluster.medianAngleDeg);
    const norm = normalVec(dir);
    const totalLen = cluster.segments.reduce((s, seg) => s + seg.length, 0);
    const conf = Math.min(0.999, 0.6 + Math.min(0.35, totalLen / 10000));
    return {
      componentId: '0',
      thetaDeg: String(cluster.medianAngleDeg.toFixed(4)),
      directionVecX: String(dir.x.toFixed(8)),
      directionVecY: String(dir.y.toFixed(8)),
      normalVecX: String(norm.x.toFixed(8)),
      normalVecY: String(norm.y.toFixed(8)),
      familyRank: fi + 1,
      confidence: String(conf.toFixed(3)),
    };
  });

  // ── Axes ──
  const axisInserts: InsertGridAxis[] = axes.map(axis => ({
    familyId: String(axis.familyIdx),
    geometryType: 'LINE' as const,
    p0X: String(axis.p0.x.toFixed(6)),
    p0Y: String(axis.p0.y.toFixed(6)),
    p1X: String(axis.p1.x.toFixed(6)),
    p1Y: String(axis.p1.y.toFixed(6)),
    offsetD: String(axis.offsetD.toFixed(6)),
    extentMinT: String(axis.extentMinT.toFixed(6)),
    extentMaxT: String(axis.extentMaxT.toFixed(6)),
    axisStyle: { layer: axis.layer, linetype: axis.lineType },
    segmentCount: axis.segmentCount,
    totalMergedLength: String(axis.totalLength.toFixed(3)),
    confidence: String(axis.confidence.toFixed(3)),
    status: 'AUTO' as const,
  }));

  // ── Nodes ──
  const nodeInserts: InsertGridNode[] = intersections.map(pt => ({
    componentId: '0',
    x: String(pt.x.toFixed(6)),
    y: String(pt.y.toFixed(6)),
    confidence: String(pt.confidence.toFixed(3)),
  }));

  // ── Node-Axis Links ──
  const nodeAxisInserts: InsertGridNodeAxis[] = [];
  for (let ni = 0; ni < intersections.length; ni++) {
    const pt = intersections[ni];
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(pt.axisIdxA) });
    nodeAxisInserts.push({ nodeId: String(ni), axisId: String(pt.axisIdxB) });
  }

  // ── Coordinate Transform ──
  const scale = unitScaleToMeters(insunits);
  const transform: InsertGridCoordinateTransform | undefined =
    scale !== 1.0 ? {
      projectId: '',
      fromFrame: 'MODEL',
      toFrame: 'MODEL',
      matrix2x3: [[scale, 0, 0], [0, scale, 0]],
      scale: String(scale.toFixed(10)),
      rotationDeg: '0',
      translationX: '0',
      translationY: '0',
      calibrationMethod: 'CAD_UNITS',
      sourceUnit: units.toLowerCase(),
      targetUnit: 'm',
      notes: `DXF INSUNITS=${insunits} → meters (×${scale})`,
    } : undefined;

  return {
    success: true,
    components,
    families: familyInserts,
    axes: axisInserts,
    markers: markerInserts,
    labels: labelInserts,
    axisLabels: axisLabelInserts,
    nodes: nodeInserts,
    nodeAxes: nodeAxisInserts,
    transform,
    warnings,
    errors,
    extractionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRID EXTRACTOR — Main Implementation
// ═══════════════════════════════════════════════════════════════════════════════

const dxfGridExtractor: GridExtractor = {
  name: 'dxf-grid-detector-v1',
  supportedTypes: ['DXF', 'DWG'],

  async extract(
    buffer: Buffer,
    classification: InputClassification,
    params: typeof DEFAULT_DETECTION_PARAMS,
    runId: string,
  ): Promise<ExtractorResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];

    // ── Step 1: Parse DXF ──
    let parsed: ParsedDxf;
    try {
      parsed = await parseDxfBuffer(buffer);
    } catch (error) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings: [],
        errors: [`DXF parse failed: ${(error as Error).message}`],
        extractionTimeMs: Date.now() - startTime,
      };
    }

    warnings.push(
      `DXF parsed: ${parsed.segments.length} segments, ` +
      `${parsed.circles.length} circles, ${parsed.texts.length} texts, ` +
      `units=${parsed.units}`
    );

    if (parsed.segments.length === 0) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings,
        errors: ['DXF contains no line segments — cannot detect grid'],
        extractionTimeMs: Date.now() - startTime,
      };
    }

    // ── Step 2: Filter Candidates ──
    const { candidates, notes: filterNotes } = filterCandidateSegments(
      parsed.segments, parsed.bounds, params, classification.detectedLayers
    );
    warnings.push(...filterNotes);

    if (candidates.length < params.angleClusterMinSupport) {
      warnings.push(
        `Only ${candidates.length} candidate segments (need ${params.angleClusterMinSupport}) — ` +
        `grid detection may be unreliable`
      );
      if (candidates.length === 0) {
        return {
          success: false,
          components: [], families: [], axes: [], markers: [],
          labels: [], axisLabels: [], nodes: [], nodeAxes: [],
          warnings,
          errors: ['No candidate segments above minimum length threshold'],
          extractionTimeMs: Date.now() - startTime,
        };
      }
    }

    // ── Step 3: DBSCAN Angle Clustering ──
    const angleClusters = dbscanAngleClustering(
      candidates,
      params.angleClusterEpsDeg,
      params.angleClusterMinSupport,
    );

    warnings.push(`Angle clustering: ${angleClusters.length} families found`);

    if (angleClusters.length === 0) {
      return {
        success: false,
        components: [], families: [], axes: [], markers: [],
        labels: [], axisLabels: [], nodes: [], nodeAxes: [],
        warnings,
        errors: ['DBSCAN found no angle clusters — no grid families detected'],
        extractionTimeMs: Date.now() - startTime,
      };
    }

    // Log family angles
    for (let i = 0; i < angleClusters.length; i++) {
      const c = angleClusters[i];
      warnings.push(
        `  Family ${i + 1}: θ=${c.medianAngleDeg.toFixed(1)}°, ` +
        `${c.segments.length} segments`
      );
    }

    // ── Steps 4-7: Offset Clustering + Merging + Axis Building ──
    const { families, axes } = buildConsolidatedAxes(angleClusters, params);
    warnings.push(`Consolidated: ${axes.length} axes across ${families.length} families`);

    if (axes.length < 2) {
      warnings.push('Fewer than 2 axes detected — grid may be incomplete');
    }

    // ── Steps 8-10: Enhanced Label Engine (WP-4) ──
    // Convert DXF-specific types to format-agnostic label engine input
    const contentBounds: ContentBounds = {
      ...parsed.bounds,
      width: Math.max(parsed.bounds.maxX - parsed.bounds.minX, 1),
      height: Math.max(parsed.bounds.maxY - parsed.bounds.minY, 1),
      diagonal: Math.sqrt(
        Math.pow(parsed.bounds.maxX - parsed.bounds.minX, 2) +
        Math.pow(parsed.bounds.maxY - parsed.bounds.minY, 2)
      ),
    };

    const axisGeometries: AxisGeometry[] = axes.map((axis, i) => ({
      index: i,
      p0: axis.p0,
      p1: axis.p1,
      familyIndex: axis.familyIdx,
      confidence: axis.confidence,
    }));

    const engineCircles: RawCircleShape[] = parsed.circles.map(c => ({
      center: c.center, radius: c.radius, layer: c.layer, source: 'CIRCLE' as const,
    }));

    const enginePolys: RawClosedPolyShape[] = parsed.closedPolys.map(p => ({
      centroid: p.centroid, vertices: p.vertices, vertexCount: p.vertexCount,
      area: p.area, perimeter: p.perimeter, layer: p.layer,
    }));

    const engineBlocks: RawBlockInsert[] = parsed.blockInserts.map(b => ({
      name: b.name, position: b.position, scaleX: b.scaleX, scaleY: b.scaleY,
      rotation: b.rotation, layer: b.layer, containsCircle: b.containsCircle,
      containsText: b.containsText, bbox: b.bbox,
    }));

    const engineTexts: RawTextEntity[] = parsed.texts.map(t => ({
      text: t.text, position: t.position, height: t.height, rotation: t.rotation,
      layer: t.layer, bbox: t.bbox, source: 'VECTOR_TEXT' as const, confidence: 1.0,
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

    // Run the enhanced label engine
    const labelResult = runLabelEngine(
      engineCircles, enginePolys, engineBlocks, engineTexts,
      axisGeometries, contentBounds, engineParams
    );
    warnings.push(...labelResult.warnings);

    // Log sequence analysis results
    for (const seq of labelResult.sequences) {
      if (seq.gaps.length > 0 || seq.duplicates.length > 0) {
        warnings.push(
          `Sequence family ${seq.familyIndex}: type=${seq.sequenceType}, ` +
          `detected=[${seq.detectedLabels.join(',')}]` +
          (seq.gaps.length > 0 ? `, GAPS=[${seq.gaps.join(',')}]` : '') +
          (seq.duplicates.length > 0 ? `, DUPLICATES=[${seq.duplicates.join(',')}]` : '')
        );
      }
    }

    // Convert engine results to insert types
    const { markers: markerInserts, labels: labelInserts, axisLabels: axisLabelInserts } =
      convertToInsertTypes(labelResult);

    // ── Step 11: Intersection Graph ──
    const intersections = computeIntersections(axes, families);
    warnings.push(`Intersections: ${intersections.length} grid nodes`);

    // ── Step 12: Package Result ──
    return packageExtractorResultEnhanced(
      families, axes, markerInserts, labelInserts, axisLabelInserts,
      intersections, parsed.bounds, parsed.insunits, parsed.units,
      runId, warnings, errors, startTime,
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION — Plug into orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

registerGridExtractor(dxfGridExtractor);

console.log('📐 DXF Grid Extractor v1 registered (DXF, DWG)');

export { dxfGridExtractor };
export default dxfGridExtractor;
