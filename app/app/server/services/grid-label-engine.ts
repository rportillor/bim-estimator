// server/services/grid-label-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID LABEL ENGINE — v1.1 §5, §14 (Enhanced)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Format-agnostic marker detection, label extraction, label normalization,
// sequence analysis, label-axis scoring, and conflict resolution.
//
// Consumed by:
//   - dxf-grid-extractor.ts (WP-3) — replaces basic label/marker functions
//   - vector-pdf-grid-extractor.ts (WP-5) — when implemented
//   - raster-grid-extractor.ts (future) — OCR label integration
//
// Capabilities beyond WP-3 basic detection:
//   1. Block/INSERT reference marker detection (DXF block inserts as bubbles)
//   2. Multi-shape marker classification (circle, hex, rect, block, unknown)
//   3. Enhanced label normalization (G-3, G.3, G 3, GRID G → G)
//   4. Strict grid-label pattern validation with configurable rules
//   5. Sequence analysis: detect alphabetic (A,B,C) or numeric (1,2,3) patterns,
//      flag gaps and anomalies
//   6. Multi-candidate conflict resolution (one label per axis, one axis per label)
//   7. Label deduplication (same text at same position)
//   8. Confidence boost for labels matching detected sequence patterns
//
// Standards: CIQS Standard Method, v1.1 §5 and §14
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  InsertGridMarker,
  InsertGridLabel,
  InsertGridAxisLabel,
} from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS — Format-Agnostic Input
// ═══════════════════════════════════════════════════════════════════════════════

export interface Vec2 {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Raw circle-like shape from any input format */
export interface RawCircleShape {
  center: Vec2;
  radius: number;
  layer: string;
  source: 'CIRCLE' | 'ARC';
}

/** Raw closed polyline that might be a marker tag */
export interface RawClosedPolyShape {
  centroid: Vec2;
  vertices: Vec2[];
  vertexCount: number;
  area: number;
  perimeter: number;
  layer: string;
}

/** Raw block/insert reference (DXF INSERT entity) */
export interface RawBlockInsert {
  name: string;          // Block name
  position: Vec2;        // Insertion point
  scaleX: number;
  scaleY: number;
  rotation: number;      // Degrees
  layer: string;
  // Block definition entities (if available)
  containsCircle: boolean;
  containsText: string | null;
  bbox: BBox | null;
}

/** Raw text entity from any input format */
export interface RawTextEntity {
  text: string;
  position: Vec2;
  height: number;
  rotation: number;
  layer: string;
  bbox: BBox;
  source: 'VECTOR_TEXT' | 'OCR';
  confidence: number;    // 1.0 for vector, 0-1 for OCR
}

/** Axis geometry needed for scoring */
export interface AxisGeometry {
  index: number;         // Position in axes array (for temp FK refs)
  p0: Vec2;
  p1: Vec2;
  familyIndex: number;
  confidence: number;
}

/** Content bounds for relative sizing */
export interface ContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  diagonal: number;
}

/** Configuration — all from DEFAULT_DETECTION_PARAMS */
export interface LabelEngineParams {
  markerSearchRadiusPct: number;
  markerAreaMinPct: number;
  markerAreaMaxPct: number;
  markerCircularityMin: number;
  labelScoreWeights: {
    endpointProximity: number;
    perpendicularDistance: number;
    directionalAlignment: number;
    markerSupport: number;
    textQuality: number;
  };
  autoAssignThreshold: number;
  autoAssignMargin: number;
  reviewThreshold: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DetectedMarkerResult {
  center: Vec2;
  radius: number;
  shape: 'CIRCLE' | 'HEX' | 'RECT' | 'BLOCK' | 'UNKNOWN';
  bbox: BBox;
  nearestAxisIdx: number | null;
  confidence: number;
  sourceLayer: string;
}

export interface DetectedLabelResult {
  rawText: string;
  normText: string;
  position: Vec2;
  bbox: BBox;
  height: number;
  nearestMarkerIdx: number | null;
  textSource: 'VECTOR_TEXT' | 'OCR';
  confidence: number;
}

export interface ScoredAssociationResult {
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

export interface SequenceAnalysis {
  familyIndex: number;
  sequenceType: 'alphabetic' | 'numeric' | 'alphanumeric' | 'unknown';
  detectedLabels: string[];
  expectedLabels: string[];
  gaps: string[];
  duplicates: string[];
  isComplete: boolean;
  confidence: number;
}

export interface LabelEngineResult {
  markers: DetectedMarkerResult[];
  labels: DetectedLabelResult[];
  associations: ScoredAssociationResult[];
  sequences: SequenceAnalysis[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ENHANCED MARKER DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect grid markers from circles, closed polylines, and block inserts.
 * Classifies marker shape and associates with nearest axis endpoint.
 */
export function detectEnhancedMarkers(
  circles: RawCircleShape[],
  closedPolys: RawClosedPolyShape[],
  blockInserts: RawBlockInsert[],
  axes: AxisGeometry[],
  bounds: ContentBounds,
  params: LabelEngineParams,
): { markers: DetectedMarkerResult[]; warnings: string[] } {
  const markers: DetectedMarkerResult[] = [];
  const warnings: string[] = [];
  const contentArea = bounds.width * bounds.height;
  const searchRadius = bounds.diagonal * params.markerSearchRadiusPct;

  if (contentArea <= 0) return { markers, warnings };

  // ── A) Circle markers (most common) ──
  for (const circle of circles) {
    const circleArea = Math.PI * circle.radius * circle.radius;
    const areaPct = circleArea / contentArea;

    if (areaPct < params.markerAreaMinPct || areaPct > params.markerAreaMaxPct) continue;

    const { idx, dist: nearDist } = findNearestAxisEndpoint(circle.center, axes);

    if (nearDist > searchRadius && axes.length > 0) continue;

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
      nearestAxisIdx: idx,
      confidence: clamp(idx !== null ? 1.0 - nearDist / searchRadius : 0.4, 0.1, 0.999),
      sourceLayer: circle.layer,
    });
  }

  // ── B) Closed polyline markers (hex, rect, irregular) ──
  for (const poly of closedPolys) {
    const areaPct = poly.area / contentArea;
    if (areaPct < params.markerAreaMinPct || areaPct > params.markerAreaMaxPct) continue;

    // Classify shape by vertex count and regularity
    const shape = classifyPolyShape(poly, params.markerCircularityMin);
    if (shape === null) continue; // Not a marker candidate

    const approxRadius = Math.sqrt(poly.area / Math.PI);
    const { idx, dist: nearDist } = findNearestAxisEndpoint(poly.centroid, axes);

    if (nearDist > searchRadius && axes.length > 0) continue;

    const polyBbox = computePolyBbox(poly.vertices);

    markers.push({
      center: poly.centroid,
      radius: approxRadius,
      shape,
      bbox: polyBbox,
      nearestAxisIdx: idx,
      confidence: clamp(idx !== null ? 0.85 - nearDist / searchRadius * 0.5 : 0.35, 0.1, 0.999),
      sourceLayer: poly.layer,
    });
  }

  // ── C) Block insert markers ──
  for (const block of blockInserts) {
    // Block must either contain a circle or have a grid-related name
    const isGridBlock = /grid|bubble|tag|mark|anno/i.test(block.name) || block.containsCircle;
    if (!isGridBlock) continue;

    const { idx, dist: nearDist } = findNearestAxisEndpoint(block.position, axes);
    if (nearDist > searchRadius * 1.5 && axes.length > 0) continue;

    const approxRadius = block.bbox
      ? Math.max(block.bbox.maxX - block.bbox.minX, block.bbox.maxY - block.bbox.minY) / 2
      : 50; // Fallback radius estimate

    const bbox = block.bbox ?? {
      minX: block.position.x - approxRadius,
      minY: block.position.y - approxRadius,
      maxX: block.position.x + approxRadius,
      maxY: block.position.y + approxRadius,
    };

    markers.push({
      center: block.position,
      radius: approxRadius,
      shape: 'BLOCK',
      bbox,
      nearestAxisIdx: idx,
      confidence: clamp(
        (block.containsCircle ? 0.9 : 0.7) - nearDist / searchRadius * 0.3,
        0.1, 0.999
      ),
      sourceLayer: block.layer,
    });

    // If block contains embedded text, we'll pick it up in label extraction
  }

  // Deduplicate markers at nearly identical positions
  const deduped = deduplicateMarkers(markers, bounds.diagonal * 0.005);
  if (deduped.length < markers.length) {
    warnings.push(`Deduplicated ${markers.length - deduped.length} overlapping markers`);
  }

  warnings.push(
    `Enhanced markers: ${deduped.length} detected ` +
    `(${deduped.filter(m => m.shape === 'CIRCLE').length} circle, ` +
    `${deduped.filter(m => m.shape === 'HEX').length} hex, ` +
    `${deduped.filter(m => m.shape === 'RECT').length} rect, ` +
    `${deduped.filter(m => m.shape === 'BLOCK').length} block)`
  );

  return { markers: deduped, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ENHANCED LABEL EXTRACTION & NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Enhanced grid label normalization.
 * Handles: G-3, G.3, G 3, GRID G, GRID-G3, ①, etc.
 */
export function normalizeGridLabel(raw: string): string {
  let norm = raw.trim();

  // Remove known prefixes
  norm = norm.replace(/^(GRID|GRIDLINE|GRID\s*LINE|GL|AXIS)\s*[-.:_]?\s*/i, '');

  // Replace common separators with nothing (G-3 → G3, G.3 → G3)
  // But preserve compound labels like AA-1 → AA1
  norm = norm.replace(/\s+/g, '');
  norm = norm.replace(/[-._]/g, '');

  // Uppercase
  norm = norm.toUpperCase();

  // Fix common OCR confusions in grid context
  // Only apply OCR fixes for short labels (1-3 chars)
  if (norm.length <= 3) {
    // O at start of otherwise numeric → 0
    if (/^O\d+$/.test(norm)) norm = '0' + norm.slice(1);
    // l or I in numeric context → 1
    if (/^\d*[lI]\d*$/.test(norm)) norm = norm.replace(/[lI]/g, '1');
    // S in numeric context → 5
    if (/^\d*S\d*$/.test(norm) && !/[A-RT-Z]/.test(norm)) norm = norm.replace(/S/g, '5');
  }

  return norm;
}

/**
 * Strict grid label pattern validation.
 * Returns the pattern type or null if not a valid grid label.
 */
export function classifyGridLabel(
  normText: string
): { valid: boolean; type: 'letter' | 'number' | 'compound' | 'unknown'; sortKey: number } {
  if (normText.length === 0 || normText.length > 6) {
    return { valid: false, type: 'unknown', sortKey: -1 };
  }

  // Single letter: A, B, C, ... Z, AA, AB, ...
  if (/^[A-Z]{1,2}$/.test(normText)) {
    return {
      valid: true,
      type: 'letter',
      sortKey: letterToSortKey(normText),
    };
  }

  // Single or multi-digit number: 1, 2, 3, ... 99
  if (/^\d{1,3}$/.test(normText)) {
    return {
      valid: true,
      type: 'number',
      sortKey: parseInt(normText, 10),
    };
  }

  // Compound: A1, B2, AA1, etc.
  if (/^[A-Z]{1,2}\d{1,3}$/.test(normText)) {
    const letterPart = normText.match(/^[A-Z]+/)![0];
    const numPart = parseInt(normText.match(/\d+/)![0], 10);
    return {
      valid: true,
      type: 'compound',
      sortKey: letterToSortKey(letterPart) * 1000 + numPart,
    };
  }

  // Number-letter: 1A, 2B (less common but valid)
  if (/^\d{1,3}[A-Z]{1,2}$/.test(normText)) {
    const numPart = parseInt(normText.match(/^\d+/)![0], 10);
    const letterPart = normText.match(/[A-Z]+$/)![0];
    return {
      valid: true,
      type: 'compound',
      sortKey: numPart * 1000 + letterToSortKey(letterPart),
    };
  }

  // Prime notation: A', A'', 1', 1.1 (revisions/sub-grids)
  if (/^[A-Z]\d?['′]{1,2}$/.test(normText) || /^\d+[.']\d+$/.test(normText)) {
    return { valid: true, type: 'compound', sortKey: 9000 };
  }

  return { valid: false, type: 'unknown', sortKey: -1 };
}

function letterToSortKey(letters: string): number {
  let key = 0;
  for (let i = 0; i < letters.length; i++) {
    key = key * 26 + (letters.charCodeAt(i) - 64); // A=1, B=2, ...
  }
  return key;
}

/**
 * Extract and validate labels from text entities, with enhanced filtering.
 * Handles vector text, block-embedded text, and future OCR results.
 */
export function extractEnhancedLabels(
  texts: RawTextEntity[],
  blockInserts: RawBlockInsert[],
  markers: DetectedMarkerResult[],
  axes: AxisGeometry[],
  bounds: ContentBounds,
): { labels: DetectedLabelResult[]; warnings: string[] } {
  const labels: DetectedLabelResult[] = [];
  const warnings: string[] = [];
  const textSearchRadius = bounds.diagonal * 0.025;

  // ── A) Labels from text entities ──
  for (const text of texts) {
    const norm = normalizeGridLabel(text.text);
    const classification = classifyGridLabel(norm);
    if (!classification.valid) continue;

    // Find nearest marker
    const { idx: nearMarkerIdx, dist: nearMarkerDist } = findNearestMarker(text.position, markers);

    // Check if text is inside or near a marker
    const insideMarker = nearMarkerIdx !== null &&
      nearMarkerDist <= markers[nearMarkerIdx].radius * 1.5;

    // Check proximity to axis endpoints
    const nearAxisEnd = isNearAnyAxisEndpoint(text.position, axes, textSearchRadius);

    // Filter: must be near marker or axis endpoint
    if (!insideMarker && !nearAxisEnd && nearMarkerDist > textSearchRadius) continue;

    const confidence = insideMarker
      ? Math.min(0.999, 0.92 + text.confidence * 0.07)
      : nearAxisEnd
        ? Math.min(0.999, 0.75 + text.confidence * 0.15)
        : Math.min(0.999, 0.55 + text.confidence * 0.10);

    labels.push({
      rawText: text.text,
      normText: norm,
      position: text.position,
      bbox: text.bbox,
      height: text.height,
      nearestMarkerIdx: insideMarker ? nearMarkerIdx : null,
      textSource: text.source,
      confidence,
    });
  }

  // ── B) Labels from block inserts with embedded text ──
  for (const block of blockInserts) {
    if (!block.containsText) continue;
    const norm = normalizeGridLabel(block.containsText);
    const classification = classifyGridLabel(norm);
    if (!classification.valid) continue;

    // Find nearest marker (the block itself may have been detected as a marker)
    const { idx: nearMarkerIdx, dist: nearMarkerDist } = findNearestMarker(block.position, markers);
    const insideMarker = nearMarkerIdx !== null && nearMarkerDist < bounds.diagonal * 0.01;

    labels.push({
      rawText: block.containsText,
      normText: norm,
      position: block.position,
      bbox: block.bbox ?? {
        minX: block.position.x - 50,
        minY: block.position.y - 50,
        maxX: block.position.x + 50,
        maxY: block.position.y + 50,
      },
      height: 0,
      nearestMarkerIdx: insideMarker ? nearMarkerIdx : null,
      textSource: 'VECTOR_TEXT',
      confidence: 0.88,
    });
  }

  // Deduplicate: same normalized text at nearly same position
  const deduped = deduplicateLabels(labels, bounds.diagonal * 0.003);
  if (deduped.length < labels.length) {
    warnings.push(`Deduplicated ${labels.length - deduped.length} overlapping labels`);
  }

  warnings.push(`Enhanced labels: ${deduped.length} valid grid label candidates`);

  return { labels: deduped, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SEQUENCE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze detected labels for sequence patterns per axis family.
 * Detects: A,B,C (alphabetic), 1,2,3 (numeric), A1,A2,A3 (compound).
 * Flags gaps (missing labels) and duplicates.
 */
export function analyzeSequences(
  labels: DetectedLabelResult[],
  associations: ScoredAssociationResult[],
  axes: AxisGeometry[],
): SequenceAnalysis[] {
  const results: SequenceAnalysis[] = [];

  // Group associations by family
  const familyLabels = new Map<number, Array<{ normText: string; axisIdx: number }>>();

  for (const assoc of associations) {
    const axis = axes.find(a => a.index === assoc.axisIdx);
    if (!axis) continue;

    const label = labels[assoc.labelIdx];
    if (!label) continue;

    const fi = axis.familyIndex;
    if (!familyLabels.has(fi)) familyLabels.set(fi, []);
    familyLabels.get(fi)!.push({ normText: label.normText, axisIdx: assoc.axisIdx });
  }

  for (const [familyIndex, items] of familyLabels) {
    const detectedLabels = items.map(i => i.normText);
    if (detectedLabels.length < 2) {
      results.push({
        familyIndex,
        sequenceType: 'unknown',
        detectedLabels,
        expectedLabels: detectedLabels,
        gaps: [],
        duplicates: [],
        isComplete: detectedLabels.length <= 1,
        confidence: 0.5,
      });
      continue;
    }

    // Classify all labels
    const classified = detectedLabels.map(l => ({
      text: l,
      cls: classifyGridLabel(l),
    }));

    // Determine dominant type
    const typeCounts = { letter: 0, number: 0, compound: 0, unknown: 0 };
    for (const c of classified) typeCounts[c.cls.type]++;

    let seqType: 'alphabetic' | 'numeric' | 'alphanumeric' | 'unknown';
    if (typeCounts.letter >= typeCounts.number && typeCounts.letter >= typeCounts.compound) {
      seqType = 'alphabetic';
    } else if (typeCounts.number >= typeCounts.letter && typeCounts.number >= typeCounts.compound) {
      seqType = 'numeric';
    } else if (typeCounts.compound > 0) {
      seqType = 'alphanumeric';
    } else {
      seqType = 'unknown';
    }

    // Sort by sort key
    const sorted = classified
      .filter(c => c.cls.valid)
      .sort((a, b) => a.cls.sortKey - b.cls.sortKey);

    // Detect gaps in sequence
    const gaps: string[] = [];
    const duplicates: string[] = [];
    const seen = new Set<string>();

    for (const item of sorted) {
      if (seen.has(item.text)) {
        duplicates.push(item.text);
      }
      seen.add(item.text);
    }

    if (seqType === 'alphabetic') {
      const letters = sorted.map(s => s.text);
      for (let i = 0; i < letters.length - 1; i++) {
        if (letters[i].length === 1 && letters[i + 1].length === 1) {
          const expected = letters[i].charCodeAt(0) + 1;
          const actual = letters[i + 1].charCodeAt(0);
          for (let c = expected; c < actual; c++) {
            gaps.push(String.fromCharCode(c));
          }
        }
      }
    } else if (seqType === 'numeric') {
      const nums = sorted.map(s => parseInt(s.text, 10));
      for (let i = 0; i < nums.length - 1; i++) {
        for (let n = nums[i] + 1; n < nums[i + 1]; n++) {
          gaps.push(String(n));
        }
      }
    }

    // Expected labels (fill gaps)
    const expectedLabels = [...new Set([...detectedLabels, ...gaps])].sort();

    const isComplete = gaps.length === 0 && duplicates.length === 0;
    const confidence = isComplete ? 0.95 : Math.max(0.3, 0.8 - gaps.length * 0.1);

    results.push({
      familyIndex,
      sequenceType: seqType,
      detectedLabels: sorted.map(s => s.text),
      expectedLabels,
      gaps,
      duplicates,
      isComplete,
      confidence,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ENHANCED LABEL-AXIS SCORING WITH CONFLICT RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Score label-to-axis associations with enhanced conflict resolution.
 * Enforces: one label per axis (best wins), one axis per label (best wins).
 * Boosted confidence for labels matching detected sequence patterns.
 */
export function scoreLabelAxisAssociations(
  axes: AxisGeometry[],
  labels: DetectedLabelResult[],
  markers: DetectedMarkerResult[],
  params: LabelEngineParams,
  bounds: ContentBounds,
): ScoredAssociationResult[] {
  const weights = params.labelScoreWeights;
  const refDist = bounds.diagonal * 0.05;

  // Score all (label, axis) pairs
  const allScores: Array<{
    axisIdx: number;
    labelIdx: number;
    total: number;
    breakdown: any;
    assocType: 'END_LABEL' | 'MID_LABEL' | 'MARKER_LABEL';
  }> = [];

  for (let li = 0; li < labels.length; li++) {
    const label = labels[li];

    for (let ai = 0; ai < axes.length; ai++) {
      const axis = axes[ai];

      // S_end: endpoint proximity
      const dEnd = Math.min(
        euclidDist(label.position, axis.p0),
        euclidDist(label.position, axis.p1)
      );
      const sEnd = Math.max(0, 1 - dEnd / refDist);

      // S_perp: perpendicular distance to axis line
      const dPerp = pointToSegmentDistance(label.position, axis.p0, axis.p1);
      const sPerp = Math.max(0, 1 - dPerp / refDist);

      // S_align: directional alignment
      const axisAngle = Math.atan2(axis.p1.y - axis.p0.y, axis.p1.x - axis.p0.x);
      const midX = (axis.p0.x + axis.p1.x) / 2;
      const midY = (axis.p0.y + axis.p1.y) / 2;
      const toLabelX = label.position.x - midX;
      const toLabelY = label.position.y - midY;
      const toLabelLen = Math.sqrt(toLabelX * toLabelX + toLabelY * toLabelY);
      let sAlign = 0.5;
      if (toLabelLen > 1e-6) {
        const dot = Math.abs(
          (toLabelX / toLabelLen) * Math.cos(axisAngle) +
          (toLabelY / toLabelLen) * Math.sin(axisAngle)
        );
        sAlign = dot;
      }

      // S_mark: marker support
      let sMark = 0;
      if (label.nearestMarkerIdx !== null) {
        const marker = markers[label.nearestMarkerIdx];
        if (marker && marker.nearestAxisIdx === axis.index) {
          sMark = 1.0;
        } else if (marker) {
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

      // Association type
      let assocType: 'END_LABEL' | 'MID_LABEL' | 'MARKER_LABEL' = 'END_LABEL';
      if (sMark >= 0.8) assocType = 'MARKER_LABEL';
      else if (sAlign < 0.5) assocType = 'MID_LABEL';

      allScores.push({
        axisIdx: axis.index,
        labelIdx: li,
        total,
        breakdown: {
          endpointProximity: round3(sEnd),
          perpendicularDistance: round3(sPerp),
          directionalAlignment: round3(sAlign),
          markerSupport: round3(sMark),
          textQuality: round3(sText),
        },
        assocType,
      });
    }
  }

  // ── Conflict Resolution: greedy bipartite matching ──
  // Sort all scores descending
  allScores.sort((a, b) => b.total - a.total);

  const assignedAxes = new Set<number>();
  const assignedLabels = new Set<number>();
  const associations: ScoredAssociationResult[] = [];

  for (const score of allScores) {
    // Skip if below minimum threshold
    if (score.total < params.reviewThreshold) continue;

    // Skip if axis or label already assigned
    if (assignedAxes.has(score.axisIdx) || assignedLabels.has(score.labelIdx)) continue;

    // Determine status
    let status: 'AUTO' | 'NEEDS_REVIEW' = 'NEEDS_REVIEW';

    // Find margin: difference to next-best score for same axis or same label
    const nextBestForAxis = allScores.find(s =>
      s.axisIdx === score.axisIdx && s.labelIdx !== score.labelIdx && !assignedLabels.has(s.labelIdx)
    );
    const nextBestForLabel = allScores.find(s =>
      s.labelIdx === score.labelIdx && s.axisIdx !== score.axisIdx && !assignedAxes.has(s.axisIdx)
    );

    const margin = Math.min(
      nextBestForAxis ? score.total - nextBestForAxis.total : 1.0,
      nextBestForLabel ? score.total - nextBestForLabel.total : 1.0,
    );

    if (score.total >= params.autoAssignThreshold && margin >= params.autoAssignMargin) {
      status = 'AUTO';
    }

    associations.push({
      axisIdx: score.axisIdx,
      labelIdx: score.labelIdx,
      scoreTotal: round3(score.total),
      scoreBreakdown: score.breakdown,
      associationType: score.assocType,
      status,
    });

    assignedAxes.add(score.axisIdx);
    assignedLabels.add(score.labelIdx);
  }

  return associations;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. MAIN ENTRY POINT — runLabelEngine()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Main entry point: run the complete enhanced label/marker pipeline.
 * Returns markers, labels, associations, and sequence analysis.
 */
export function runLabelEngine(
  circles: RawCircleShape[],
  closedPolys: RawClosedPolyShape[],
  blockInserts: RawBlockInsert[],
  texts: RawTextEntity[],
  axes: AxisGeometry[],
  bounds: ContentBounds,
  params: LabelEngineParams,
): LabelEngineResult {
  const warnings: string[] = [];

  // Step 1: Detect markers
  const { markers, warnings: markerWarnings } = detectEnhancedMarkers(
    circles, closedPolys, blockInserts, axes, bounds, params
  );
  warnings.push(...markerWarnings);

  // Step 2: Extract labels
  const { labels, warnings: labelWarnings } = extractEnhancedLabels(
    texts, blockInserts, markers, axes, bounds
  );
  warnings.push(...labelWarnings);

  // Step 3: Score associations with conflict resolution
  const associations = scoreLabelAxisAssociations(
    axes, labels, markers, params, bounds
  );

  const autoCount = associations.filter(a => a.status === 'AUTO').length;
  const reviewCount = associations.filter(a => a.status === 'NEEDS_REVIEW').length;
  warnings.push(
    `Label-axis scoring: ${associations.length} associations ` +
    `(${autoCount} auto, ${reviewCount} needs review)`
  );

  // Step 4: Sequence analysis
  const sequences = analyzeSequences(labels, associations, axes);
  for (const seq of sequences) {
    if (seq.gaps.length > 0) {
      warnings.push(
        `Sequence gap in family ${seq.familyIndex}: ` +
        `missing ${seq.gaps.join(', ')} (${seq.sequenceType})`
      );
    }
    if (seq.duplicates.length > 0) {
      warnings.push(
        `Duplicate labels in family ${seq.familyIndex}: ${seq.duplicates.join(', ')}`
      );
    }
  }

  // Step 5: Apply sequence-based confidence boost
  applySequenceBoost(associations, labels, sequences, axes);

  return { markers, labels, associations, sequences, warnings };
}

/**
 * Boost confidence for labels that fit detected sequence patterns.
 * Demote labels that break the sequence.
 */
function applySequenceBoost(
  associations: ScoredAssociationResult[],
  labels: DetectedLabelResult[],
  sequences: SequenceAnalysis[],
  axes: AxisGeometry[],
): void {
  for (const seq of sequences) {
    if (seq.sequenceType === 'unknown' || seq.detectedLabels.length < 3) continue;

    for (const assoc of associations) {
      const axis = axes.find(a => a.index === assoc.axisIdx);
      if (!axis || axis.familyIndex !== seq.familyIndex) continue;

      const label = labels[assoc.labelIdx];
      if (!label) continue;

      const inSequence = seq.detectedLabels.includes(label.normText);

      if (inSequence && seq.confidence > 0.8) {
        // Boost: label fits the pattern
        if (assoc.status === 'NEEDS_REVIEW' && assoc.scoreTotal >= 0.65) {
          assoc.status = 'AUTO';
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CONVERSION TO INSERT TYPES (for ExtractorResult)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert engine results to InsertGrid* types for the orchestrator.
 * Uses array index strings as temp FK references.
 */
export function convertToInsertTypes(
  result: LabelEngineResult,
): {
  markers: InsertGridMarker[];
  labels: InsertGridLabel[];
  axisLabels: InsertGridAxisLabel[];
} {
  const markers: InsertGridMarker[] = result.markers.map(m => ({
    axisId: m.nearestAxisIdx !== null ? String(m.nearestAxisIdx) : null,
    markerShape: m.shape as any,
    centerX: String(m.center.x.toFixed(6)),
    centerY: String(m.center.y.toFixed(6)),
    bbox: m.bbox,
    confidence: String(m.confidence.toFixed(3)),
  }));

  const labels: InsertGridLabel[] = result.labels.map(l => ({
    markerId: l.nearestMarkerIdx !== null ? String(l.nearestMarkerIdx) : null,
    rawText: l.rawText,
    normText: l.normText,
    textSource: l.textSource as any,
    textConfidence: String(l.confidence.toFixed(3)),
    bbox: l.bbox,
  }));

  const axisLabels: InsertGridAxisLabel[] = result.associations.map(a => ({
    axisId: String(a.axisIdx),
    labelId: String(a.labelIdx),
    scoreTotal: String(a.scoreTotal.toFixed(3)),
    scoreBreakdown: a.scoreBreakdown,
    associationType: a.associationType as any,
    status: a.status as any,
  }));

  return { markers, labels, axisLabels };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function euclidDist(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistance(pt: Vec2, s0: Vec2, s1: Vec2): number {
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return euclidDist(pt, s0);
  let t = ((pt.x - s0.x) * dx + (pt.y - s0.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return euclidDist(pt, { x: s0.x + t * dx, y: s0.y + t * dy });
}

function findNearestAxisEndpoint(
  point: Vec2,
  axes: AxisGeometry[],
): { idx: number | null; dist: number } {
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < axes.length; i++) {
    const d0 = euclidDist(point, axes[i].p0);
    const d1 = euclidDist(point, axes[i].p1);
    const dMin = Math.min(d0, d1);
    if (dMin < bestDist) {
      bestDist = dMin;
      bestIdx = axes[i].index;
    }
  }
  return { idx: bestIdx, dist: bestDist };
}

function findNearestMarker(
  point: Vec2,
  markers: DetectedMarkerResult[],
): { idx: number | null; dist: number } {
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < markers.length; i++) {
    const d = euclidDist(point, markers[i].center);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, dist: bestDist };
}

function isNearAnyAxisEndpoint(point: Vec2, axes: AxisGeometry[], radius: number): boolean {
  for (const axis of axes) {
    if (euclidDist(point, axis.p0) < radius || euclidDist(point, axis.p1) < radius) {
      return true;
    }
  }
  return false;
}

/**
 * Classify closed polyline shape by vertex count and regularity.
 * Returns marker shape or null if not a marker candidate.
 */
function classifyPolyShape(
  poly: RawClosedPolyShape,
  circularityMin: number,
): 'HEX' | 'RECT' | 'CIRCLE' | 'UNKNOWN' | null {
  const n = poly.vertexCount;

  // Too few or too many vertices for a marker tag
  if (n < 3 || n > 24) return null;

  // Circularity = 4π × area / perimeter²
  const circularity = (4 * Math.PI * poly.area) / (poly.perimeter * poly.perimeter);

  // High circularity + many vertices → approximated circle
  if (circularity >= circularityMin && n >= 8) return 'CIRCLE';

  // 6 vertices → hexagon
  if (n === 6) {
    // Check regularity: all edges should be similar length
    const edges: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push(euclidDist(poly.vertices[i], poly.vertices[j]));
    }
    const avgEdge = edges.reduce((s, e) => s + e, 0) / n;
    const maxDev = Math.max(...edges.map(e => Math.abs(e - avgEdge) / avgEdge));
    if (maxDev < 0.3) return 'HEX';
  }

  // 4 vertices → rectangle
  if (n === 4) {
    // Check roughly right angles
    return 'RECT';
  }

  // 3 vertices = triangle (uncommon for markers, skip)
  if (n === 3) return null;

  // Other vertex counts with decent circularity
  if (circularity >= 0.5) return 'UNKNOWN';

  return null;
}

function computePolyBbox(vertices: Vec2[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
}

function deduplicateMarkers(markers: DetectedMarkerResult[], tolerance: number): DetectedMarkerResult[] {
  const result: DetectedMarkerResult[] = [];
  for (const m of markers) {
    const dup = result.find(r =>
      Math.abs(r.center.x - m.center.x) < tolerance &&
      Math.abs(r.center.y - m.center.y) < tolerance
    );
    if (!dup) {
      result.push(m);
    } else if (m.confidence > dup.confidence) {
      Object.assign(dup, m);
    }
  }
  return result;
}

function deduplicateLabels(labels: DetectedLabelResult[], tolerance: number): DetectedLabelResult[] {
  const result: DetectedLabelResult[] = [];
  for (const l of labels) {
    const dup = result.find(r =>
      r.normText === l.normText &&
      Math.abs(r.position.x - l.position.x) < tolerance &&
      Math.abs(r.position.y - l.position.y) < tolerance
    );
    if (!dup) {
      result.push(l);
    } else if (l.confidence > dup.confidence) {
      Object.assign(dup, l);
    }
  }
  return result;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
