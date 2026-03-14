/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SHEET PRODUCTION ENGINE — 2D Drawing Generation from 3D BIM Model
 *  Generates:
 *  - Floor plans (plan views per storey)
 *  - Building sections (vertical cuts through model)
 *  - Elevations (exterior views from cardinal directions)
 *  - Detail views (zoomed areas with dimensions)
 *  - Title blocks with project metadata
 *  Output format: SVG (vector, scalable, browser-renderable).
 *  All dimensions in metres. Z-up coordinate system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { BIMSolid } from './parametric-elements';
import type { Vec3, Vec2, AABB } from './geometry-kernel';
import { vec3, vec2, v3sub, v3len, v3add, v3scale } from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ViewType = 'plan' | 'section' | 'elevation' | 'detail' | 'isometric';
export type ViewDirection = 'top' | 'north' | 'south' | 'east' | 'west' | 'custom';
export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'ARCH_D' | 'ARCH_E';

export interface SheetConfig {
  paperSize: PaperSize;
  orientation: 'landscape' | 'portrait';
  scale: number;              // e.g. 100 = 1:100
  titleBlock: TitleBlock;
  margins: { top: number; bottom: number; left: number; right: number };  // mm
}

export interface TitleBlock {
  projectName: string;
  projectNumber: string;
  sheetTitle: string;
  sheetNumber: string;
  drawnBy: string;
  checkedBy: string;
  date: string;
  revision: string;
  company: string;
  logo?: string;             // SVG or data URL
}

export interface ViewConfig {
  type: ViewType;
  direction: ViewDirection;
  storey?: string;           // for plan views
  sectionLine?: { start: Vec2; end: Vec2 };  // for section views
  cutHeight?: number;        // metres above storey for plan cut (default 1.2m)
  viewDepth?: number;        // how deep to look (metres)
  showGrid: boolean;
  showDimensions: boolean;
  showAnnotations: boolean;
  showHatching: boolean;
  showRoomLabels: boolean;
  lineWeights: LineWeightConfig;
  elementFilter?: {
    types?: string[];
    categories?: string[];
    worksets?: string[];
  };
}

export interface LineWeightConfig {
  cutLine: number;          // mm — elements cut by section plane
  projectedLine: number;    // mm — elements behind section plane
  dimensionLine: number;    // mm
  gridLine: number;         // mm
  annotationLine: number;   // mm
  hiddenLine: number;       // mm — dashed lines for hidden elements
}

const DEFAULT_LINE_WEIGHTS: LineWeightConfig = {
  cutLine: 0.5,
  projectedLine: 0.25,
  dimensionLine: 0.18,
  gridLine: 0.13,
  annotationLine: 0.25,
  hiddenLine: 0.13,
};

export interface Sheet {
  id: string;
  config: SheetConfig;
  views: ViewOnSheet[];
  svg: string;
}

export interface ViewOnSheet {
  viewConfig: ViewConfig;
  position: Vec2;           // position on sheet (mm from origin)
  width: number;            // viewport width on sheet (mm)
  height: number;           // viewport height on sheet (mm)
}

// Paper sizes in mm
const PAPER_SIZES: Record<PaperSize, { width: number; height: number }> = {
  'A0': { width: 1189, height: 841 },
  'A1': { width: 841, height: 594 },
  'A2': { width: 594, height: 420 },
  'A3': { width: 420, height: 297 },
  'A4': { width: 297, height: 210 },
  'ARCH_D': { width: 914, height: 610 },
  'ARCH_E': { width: 1219, height: 914 },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  2D PROJECTION — Project 3D elements onto 2D view plane
// ═══════════════════════════════════════════════════════════════════════════════

interface Projected2DLine {
  start: Vec2;
  end: Vec2;
  weight: number;          // line weight in mm
  style: 'solid' | 'dashed' | 'dotted' | 'center';
  color: string;
  layer: string;           // element type for filtering
  elementId: string;
}

interface Projected2DLabel {
  position: Vec2;
  text: string;
  fontSize: number;        // mm
  rotation: number;        // degrees
  anchor: 'start' | 'middle' | 'end';
  layer: string;
}

interface Projected2DHatch {
  boundary: Vec2[];
  pattern: 'concrete' | 'masonry' | 'insulation' | 'steel' | 'earth' | 'none';
  scale: number;
  layer: string;
}

interface ProjectedView {
  lines: Projected2DLine[];
  labels: Projected2DLabel[];
  hatches: Projected2DHatch[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Project BIM elements for a floor plan view.
 * Cuts horizontally at cutHeight above storey elevation.
 */
function projectPlanView(
  elements: BIMSolid[],
  storeyElevation: number,
  cutHeight: number,
  lineWeights: LineWeightConfig,
): ProjectedView {
  const lines: Projected2DLine[] = [];
  const labels: Projected2DLabel[] = [];
  const hatches: Projected2DHatch[] = [];
  const cutZ = storeyElevation + cutHeight;

  for (const el of elements) {
    const bb = el.boundingBox;

    // Skip elements entirely above or below the cut plane
    if (bb.min.z > cutZ + 0.1 || bb.max.z < storeyElevation - 0.1) continue;

    const isCut = bb.min.z < cutZ && bb.max.z > cutZ;
    const weight = isCut ? lineWeights.cutLine : lineWeights.projectedLine;
    const style: 'solid' | 'dashed' = isCut ? 'solid' : 'dashed';

    // Project bounding box outline in XY
    if (el.type === 'Wall') {
      // Walls: draw as thick lines along their length
      const cos = Math.cos(el.rotation);
      const sin = Math.sin(el.rotation);
      const halfLen = (el.quantities.length || 1) / 2;
      const halfThk = (el.quantities.thickness || 0.2) / 2;

      // Four corners of wall footprint
      const corners: Vec2[] = [
        vec2(el.origin.x + cos * halfLen - sin * halfThk, el.origin.y + sin * halfLen + cos * halfThk),
        vec2(el.origin.x + cos * halfLen + sin * halfThk, el.origin.y + sin * halfLen - cos * halfThk),
        vec2(el.origin.x - cos * halfLen + sin * halfThk, el.origin.y - sin * halfLen - cos * halfThk),
        vec2(el.origin.x - cos * halfLen - sin * halfThk, el.origin.y - sin * halfLen + cos * halfThk),
      ];

      for (let i = 0; i < 4; i++) {
        lines.push({
          start: corners[i],
          end: corners[(i + 1) % 4],
          weight: isCut ? weight : lineWeights.projectedLine,
          style,
          color: '#000000',
          layer: 'Wall',
          elementId: el.id,
        });
      }

      // Wall hatch pattern if cut
      if (isCut) {
        hatches.push({
          boundary: corners,
          pattern: inferHatchPattern(el.material),
          scale: 1,
          layer: 'Wall',
        });
      }
    } else if (el.type === 'Column') {
      // Columns: draw as filled rectangles/circles
      const w = el.quantities.width || el.quantities.thickness || 0.3;
      const d = el.quantities.length || w;
      const hw = w / 2, hd = d / 2;

      const corners: Vec2[] = [
        vec2(el.origin.x - hw, el.origin.y - hd),
        vec2(el.origin.x + hw, el.origin.y - hd),
        vec2(el.origin.x + hw, el.origin.y + hd),
        vec2(el.origin.x - hw, el.origin.y + hd),
      ];

      for (let i = 0; i < 4; i++) {
        lines.push({
          start: corners[i],
          end: corners[(i + 1) % 4],
          weight,
          style: 'solid',
          color: '#000000',
          layer: 'Column',
          elementId: el.id,
        });
      }

      // Cross-hatch for cut columns
      if (isCut) {
        lines.push({ start: corners[0], end: corners[2], weight: lineWeights.projectedLine, style: 'solid', color: '#666666', layer: 'Column', elementId: el.id });
        lines.push({ start: corners[1], end: corners[3], weight: lineWeights.projectedLine, style: 'solid', color: '#666666', layer: 'Column', elementId: el.id });
      }

      // Column label
      labels.push({
        position: vec2(el.origin.x, el.origin.y - hd - 0.15),
        text: el.name,
        fontSize: 2.5,
        rotation: 0,
        anchor: 'middle',
        layer: 'Column',
      });
    } else if (el.type === 'Door') {
      // Door: draw swing arc and opening in wall
      const w = el.quantities.width || 0.9;
      const cos = Math.cos(el.rotation);
      const sin = Math.sin(el.rotation);

      // Door opening line
      lines.push({
        start: vec2(el.origin.x - sin * w / 2, el.origin.y + cos * w / 2),
        end: vec2(el.origin.x + sin * w / 2, el.origin.y - cos * w / 2),
        weight: lineWeights.cutLine,
        style: 'solid',
        color: '#000000',
        layer: 'Door',
        elementId: el.id,
      });

      // Swing arc (quarter circle)
      const arcSegs = 12;
      const hinge = vec2(el.origin.x - sin * w / 2, el.origin.y + cos * w / 2);
      for (let i = 0; i < arcSegs; i++) {
        const a1 = el.rotation + (Math.PI / 2) * (i / arcSegs);
        const a2 = el.rotation + (Math.PI / 2) * ((i + 1) / arcSegs);
        lines.push({
          start: vec2(hinge.x + Math.cos(a1) * w, hinge.y + Math.sin(a1) * w),
          end: vec2(hinge.x + Math.cos(a2) * w, hinge.y + Math.sin(a2) * w),
          weight: lineWeights.projectedLine,
          style: 'solid',
          color: '#000000',
          layer: 'Door',
          elementId: el.id,
        });
      }

      // Door number label
      labels.push({
        position: vec2(el.origin.x, el.origin.y),
        text: el.name,
        fontSize: 2,
        rotation: 0,
        anchor: 'middle',
        layer: 'Door',
      });
    } else if (el.type === 'Window') {
      // Window: draw as break in wall with parallel lines
      const w = el.quantities.width || 1.0;
      const cos = Math.cos(el.rotation);
      const sin = Math.sin(el.rotation);
      const thk = 0.05; // window frame thickness on plan

      for (const offset of [-thk, thk]) {
        lines.push({
          start: vec2(el.origin.x - sin * w / 2 + cos * offset, el.origin.y + cos * w / 2 + sin * offset),
          end: vec2(el.origin.x + sin * w / 2 + cos * offset, el.origin.y - cos * w / 2 + sin * offset),
          weight: lineWeights.projectedLine,
          style: 'solid',
          color: '#000000',
          layer: 'Window',
          elementId: el.id,
        });
      }
    } else if (el.type === 'Stair') {
      // Stairs: draw treads with up arrow
      const w = el.quantities.width || 1.2;
      const l = el.quantities.length || 3;
      const cos = Math.cos(el.rotation);
      const sin = Math.sin(el.rotation);

      // Outline
      const corners: Vec2[] = [
        vec2(el.origin.x, el.origin.y),
        vec2(el.origin.x + cos * l, el.origin.y + sin * l),
        vec2(el.origin.x + cos * l - sin * w, el.origin.y + sin * l + cos * w),
        vec2(el.origin.x - sin * w, el.origin.y + cos * w),
      ];

      for (let i = 0; i < 4; i++) {
        lines.push({
          start: corners[i],
          end: corners[(i + 1) % 4],
          weight,
          style: 'solid',
          color: '#000000',
          layer: 'Stair',
          elementId: el.id,
        });
      }

      // Tread lines (typically 250mm going)
      const treadCount = Math.floor(l / 0.25);
      for (let t = 1; t < treadCount; t++) {
        const offset = (t / treadCount) * l;
        lines.push({
          start: vec2(el.origin.x + cos * offset, el.origin.y + sin * offset),
          end: vec2(el.origin.x + cos * offset - sin * w, el.origin.y + sin * offset + cos * w),
          weight: lineWeights.projectedLine,
          style: 'solid',
          color: '#666666',
          layer: 'Stair',
          elementId: el.id,
        });
      }

      // UP arrow
      const midX = el.origin.x + cos * l / 2 - sin * w / 2;
      const midY = el.origin.y + sin * l / 2 + cos * w / 2;
      labels.push({
        position: vec2(midX, midY),
        text: 'UP',
        fontSize: 3,
        rotation: (el.rotation * 180) / Math.PI,
        anchor: 'middle',
        layer: 'Stair',
      });
    } else if (el.category === 'MEP') {
      // MEP: draw as dashed centerline with size indicator
      const cos = Math.cos(el.rotation);
      const sin = Math.sin(el.rotation);
      const len = el.quantities.length || 1;

      lines.push({
        start: vec2(el.origin.x, el.origin.y),
        end: vec2(el.origin.x + cos * len, el.origin.y + sin * len),
        weight: lineWeights.hiddenLine,
        style: 'dashed',
        color: el.type.includes('Duct') ? '#0066CC' : el.type.includes('Pipe') ? '#CC0000' : '#00CC00',
        layer: el.type,
        elementId: el.id,
      });
    } else {
      // Generic: project bounding box
      lines.push(
        { start: vec2(bb.min.x, bb.min.y), end: vec2(bb.max.x, bb.min.y), weight, style, color: '#000000', layer: el.type, elementId: el.id },
        { start: vec2(bb.max.x, bb.min.y), end: vec2(bb.max.x, bb.max.y), weight, style, color: '#000000', layer: el.type, elementId: el.id },
        { start: vec2(bb.max.x, bb.max.y), end: vec2(bb.min.x, bb.max.y), weight, style, color: '#000000', layer: el.type, elementId: el.id },
        { start: vec2(bb.min.x, bb.max.y), end: vec2(bb.min.x, bb.min.y), weight, style, color: '#000000', layer: el.type, elementId: el.id },
      );
    }
  }

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) {
    minX = Math.min(minX, line.start.x, line.end.x);
    minY = Math.min(minY, line.start.y, line.end.y);
    maxX = Math.max(maxX, line.start.x, line.end.x);
    maxY = Math.max(maxY, line.start.y, line.end.y);
  }

  return { lines, labels, hatches, bounds: { minX, minY, maxX, maxY } };
}

/**
 * Project BIM elements for a section view.
 * Cuts vertically along sectionLine and looks in the specified direction.
 */
function projectSectionView(
  elements: BIMSolid[],
  sectionStart: Vec2,
  sectionEnd: Vec2,
  viewDepth: number,
  lineWeights: LineWeightConfig,
): ProjectedView {
  const lines: Projected2DLine[] = [];
  const labels: Projected2DLabel[] = [];
  const hatches: Projected2DHatch[] = [];

  // Section plane direction
  const dx = sectionEnd.x - sectionStart.x;
  const dy = sectionEnd.y - sectionStart.y;
  const sectionLen = Math.sqrt(dx * dx + dy * dy);
  if (sectionLen < 0.001) return { lines, labels, hatches, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };

  const dirX = dx / sectionLen;
  const dirY = dy / sectionLen;
  // Normal to section (view direction)
  const normX = -dirY;
  const normY = dirX;

  for (const el of elements) {
    const bb = el.boundingBox;

    // Check if element is near the section plane
    const centerX = (bb.min.x + bb.max.x) / 2;
    const centerY = (bb.min.y + bb.max.y) / 2;

    // Distance from section line
    const distFromLine = Math.abs(
      (centerX - sectionStart.x) * normX + (centerY - sectionStart.y) * normY,
    );

    // Position along section line
    const posAlongLine = (centerX - sectionStart.x) * dirX + (centerY - sectionStart.y) * dirY;

    // Skip elements too far from section or outside section length
    if (distFromLine > viewDepth) continue;
    if (posAlongLine < -1 || posAlongLine > sectionLen + 1) continue;

    const isCut = distFromLine < Math.max(
      (el.quantities.thickness || 0.2) / 2 + 0.1,
      (el.quantities.width || 0.2) / 2 + 0.1,
    );

    const weight = isCut ? lineWeights.cutLine : lineWeights.projectedLine;
    const style: 'solid' | 'dashed' = isCut ? 'solid' : 'dashed';

    // Project onto section plane: X = position along section, Y = Z elevation
    const projX = posAlongLine;
    const projMinZ = bb.min.z;
    const projMaxZ = bb.max.z;

    // Element extent along section
    const halfExtent = Math.max(
      (el.quantities.length || 0) / 2,
      (el.quantities.width || 0) / 2,
      0.1,
    );

    // Draw rectangle in section view
    const corners: Vec2[] = [
      vec2(projX - halfExtent, projMinZ),
      vec2(projX + halfExtent, projMinZ),
      vec2(projX + halfExtent, projMaxZ),
      vec2(projX - halfExtent, projMaxZ),
    ];

    for (let i = 0; i < 4; i++) {
      lines.push({
        start: corners[i],
        end: corners[(i + 1) % 4],
        weight,
        style,
        color: '#000000',
        layer: el.type,
        elementId: el.id,
      });
    }

    // Hatching for cut elements
    if (isCut) {
      hatches.push({
        boundary: corners,
        pattern: inferHatchPattern(el.material),
        scale: 1,
        layer: el.type,
      });
    }

    // Element label
    labels.push({
      position: vec2(projX, projMaxZ + 0.1),
      text: el.name,
      fontSize: 2,
      rotation: 0,
      anchor: 'middle',
      layer: el.type,
    });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) {
    minX = Math.min(minX, line.start.x, line.end.x);
    minY = Math.min(minY, line.start.y, line.end.y);
    maxX = Math.max(maxX, line.start.x, line.end.x);
    maxY = Math.max(maxY, line.start.y, line.end.y);
  }

  return { lines, labels, hatches, bounds: { minX, minY, maxX, maxY } };
}

/**
 * Project BIM elements for an elevation view.
 */
function projectElevationView(
  elements: BIMSolid[],
  direction: ViewDirection,
  lineWeights: LineWeightConfig,
): ProjectedView {
  // Map direction to projection axes
  let xAxis: 'x' | 'y';
  let flipX: boolean;

  switch (direction) {
    case 'north': xAxis = 'x'; flipX = false; break;
    case 'south': xAxis = 'x'; flipX = true; break;
    case 'east': xAxis = 'y'; flipX = false; break;
    case 'west': xAxis = 'y'; flipX = true; break;
    default: xAxis = 'x'; flipX = false;
  }

  const lines: Projected2DLine[] = [];
  const labels: Projected2DLabel[] = [];

  for (const el of elements) {
    const bb = el.boundingBox;
    const x1 = flipX ? -bb.max[xAxis] : bb.min[xAxis];
    const x2 = flipX ? -bb.min[xAxis] : bb.max[xAxis];
    const z1 = bb.min.z;
    const z2 = bb.max.z;

    const weight = lineWeights.projectedLine;

    // Draw bounding rectangle
    lines.push(
      { start: vec2(x1, z1), end: vec2(x2, z1), weight, style: 'solid', color: '#000000', layer: el.type, elementId: el.id },
      { start: vec2(x2, z1), end: vec2(x2, z2), weight, style: 'solid', color: '#000000', layer: el.type, elementId: el.id },
      { start: vec2(x2, z2), end: vec2(x1, z2), weight, style: 'solid', color: '#000000', layer: el.type, elementId: el.id },
      { start: vec2(x1, z2), end: vec2(x1, z1), weight, style: 'solid', color: '#000000', layer: el.type, elementId: el.id },
    );
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const line of lines) {
    minX = Math.min(minX, line.start.x, line.end.x);
    minY = Math.min(minY, line.start.y, line.end.y);
    maxX = Math.max(maxX, line.start.x, line.end.x);
    maxY = Math.max(maxY, line.start.y, line.end.y);
  }

  return { lines, labels, hatches: [], bounds: { minX, minY, maxX, maxY } };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DIMENSION GENERATION — Auto-dimension elements
// ═══════════════════════════════════════════════════════════════════════════════

interface Dimension {
  start: Vec2;
  end: Vec2;
  offset: number;          // distance from element (mm on sheet)
  text: string;
  precision: number;       // decimal places
}

function generateDimensions(
  view: ProjectedView,
  scale: number,
): Projected2DLine[] {
  const dimLines: Projected2DLine[] = [];
  const offset = 0.5; // 0.5m offset from elements

  // Group lines by element
  const elementLines = new Map<string, Vec2[]>();
  for (const line of view.lines) {
    if (!elementLines.has(line.elementId)) elementLines.set(line.elementId, []);
    const pts = elementLines.get(line.elementId)!;
    pts.push(line.start, line.end);
  }

  // Generate overall dimensions for the view
  if (view.bounds.maxX - view.bounds.minX > 0.01) {
    const y = view.bounds.minY - offset;
    // Overall horizontal dimension
    dimLines.push({
      start: vec2(view.bounds.minX, y),
      end: vec2(view.bounds.maxX, y),
      weight: 0.18,
      style: 'solid',
      color: '#333333',
      layer: 'Dimension',
      elementId: 'dim_overall_h',
    });
    // Witness lines
    dimLines.push(
      { start: vec2(view.bounds.minX, view.bounds.minY), end: vec2(view.bounds.minX, y - 0.1), weight: 0.13, style: 'solid', color: '#333333', layer: 'Dimension', elementId: 'dim_wit_h1' },
      { start: vec2(view.bounds.maxX, view.bounds.minY), end: vec2(view.bounds.maxX, y - 0.1), weight: 0.13, style: 'solid', color: '#333333', layer: 'Dimension', elementId: 'dim_wit_h2' },
    );
  }

  if (view.bounds.maxY - view.bounds.minY > 0.01) {
    const x = view.bounds.minX - offset;
    // Overall vertical dimension
    dimLines.push({
      start: vec2(x, view.bounds.minY),
      end: vec2(x, view.bounds.maxY),
      weight: 0.18,
      style: 'solid',
      color: '#333333',
      layer: 'Dimension',
      elementId: 'dim_overall_v',
    });
    dimLines.push(
      { start: vec2(view.bounds.minX, view.bounds.minY), end: vec2(x - 0.1, view.bounds.minY), weight: 0.13, style: 'solid', color: '#333333', layer: 'Dimension', elementId: 'dim_wit_v1' },
      { start: vec2(view.bounds.minX, view.bounds.maxY), end: vec2(x - 0.1, view.bounds.maxY), weight: 0.13, style: 'solid', color: '#333333', layer: 'Dimension', elementId: 'dim_wit_v2' },
    );
  }

  return dimLines;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SVG RENDERER — Convert projected view to SVG string
// ═══════════════════════════════════════════════════════════════════════════════

function renderViewToSVG(
  view: ProjectedView,
  viewportX: number,
  viewportY: number,
  viewportW: number,
  viewportH: number,
  scale: number,
  showDimensions: boolean,
  showAnnotations: boolean,
): string {
  const parts: string[] = [];
  const { minX, minY, maxX, maxY } = view.bounds;
  const modelW = maxX - minX;
  const modelH = maxY - minY;

  if (modelW < 0.001 || modelH < 0.001) return '';

  // Scale factor: model metres → mm on sheet
  const scaleFactor = Math.min(viewportW / modelW, viewportH / modelH) * 0.9;

  const offsetX = viewportX + (viewportW - modelW * scaleFactor) / 2;
  const offsetY = viewportY + (viewportH - modelH * scaleFactor) / 2;

  function tx(x: number): number { return offsetX + (x - minX) * scaleFactor; }
  function ty(y: number): number { return offsetY + (maxY - y) * scaleFactor; } // flip Y

  // Draw hatches first (background)
  for (const hatch of view.hatches) {
    if (hatch.boundary.length < 3) continue;
    const pts = hatch.boundary.map(p => `${tx(p.x).toFixed(2)},${ty(p.y).toFixed(2)}`).join(' ');
    const fill = hatchFill(hatch.pattern);
    parts.push(`<polygon points="${pts}" fill="${fill}" stroke="none" opacity="0.3"/>`);
  }

  // Draw lines
  for (const line of view.lines) {
    const x1 = tx(line.start.x).toFixed(2);
    const y1 = ty(line.start.y).toFixed(2);
    const x2 = tx(line.end.x).toFixed(2);
    const y2 = ty(line.end.y).toFixed(2);
    const sw = (line.weight * scaleFactor / (1000 / scale)).toFixed(3);

    let dashArray = '';
    if (line.style === 'dashed') dashArray = ` stroke-dasharray="${(3 * line.weight).toFixed(1)},${(2 * line.weight).toFixed(1)}"`;
    else if (line.style === 'dotted') dashArray = ` stroke-dasharray="${(1 * line.weight).toFixed(1)},${(2 * line.weight).toFixed(1)}"`;
    else if (line.style === 'center') dashArray = ` stroke-dasharray="${(6 * line.weight).toFixed(1)},${(2 * line.weight).toFixed(1)},${(2 * line.weight).toFixed(1)},${(2 * line.weight).toFixed(1)}"`;

    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line.color}" stroke-width="${sw}"${dashArray} stroke-linecap="round"/>`);
  }

  // Draw dimension lines
  if (showDimensions) {
    const dimLines = generateDimensions(view, scale);
    for (const line of dimLines) {
      const x1 = tx(line.start.x).toFixed(2);
      const y1 = ty(line.start.y).toFixed(2);
      const x2 = tx(line.end.x).toFixed(2);
      const y2 = ty(line.end.y).toFixed(2);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line.color}" stroke-width="0.5"/>`);

      // Dimension text
      const dist = Math.sqrt(
        (line.end.x - line.start.x) ** 2 + (line.end.y - line.start.y) ** 2
      );
      const midX = ((parseFloat(x1) + parseFloat(x2)) / 2).toFixed(2);
      const midY = ((parseFloat(y1) + parseFloat(y2)) / 2 - 2).toFixed(2);
      const dimText = dist >= 1 ? `${dist.toFixed(2)}m` : `${(dist * 1000).toFixed(0)}mm`;
      parts.push(`<text x="${midX}" y="${midY}" text-anchor="middle" font-size="8" font-family="Arial" fill="#333333">${dimText}</text>`);
    }
  }

  // Draw labels
  if (showAnnotations) {
    for (const label of view.labels) {
      const x = tx(label.position.x).toFixed(2);
      const y = ty(label.position.y).toFixed(2);
      const fs = (label.fontSize * scaleFactor / (1000 / scale)).toFixed(1);
      const transform = label.rotation ? ` transform="rotate(${-label.rotation},${x},${y})"` : '';
      parts.push(`<text x="${x}" y="${y}" text-anchor="${label.anchor}" font-size="${fs}" font-family="Arial" fill="#333333"${transform}>${escapeXml(label.text)}</text>`);
    }
  }

  return parts.join('\n');
}

function hatchFill(pattern: string): string {
  switch (pattern) {
    case 'concrete': return '#CCCCCC';
    case 'masonry': return '#DDB8A0';
    case 'insulation': return '#FFFFAA';
    case 'steel': return '#AAAACC';
    case 'earth': return '#C8A070';
    default: return '#EEEEEE';
  }
}

function inferHatchPattern(material: string): 'concrete' | 'masonry' | 'insulation' | 'steel' | 'earth' | 'none' {
  const m = material.toLowerCase();
  if (m.includes('concrete')) return 'concrete';
  if (m.includes('brick') || m.includes('masonry') || m.includes('cmu')) return 'masonry';
  if (m.includes('insulation') || m.includes('fibreglass')) return 'insulation';
  if (m.includes('steel') || m.includes('metal')) return 'steel';
  if (m.includes('earth') || m.includes('soil') || m.includes('gravel')) return 'earth';
  return 'none';
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TITLE BLOCK RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

function renderTitleBlock(
  config: SheetConfig,
  paperW: number,
  paperH: number,
): string {
  const tb = config.titleBlock;
  const blockW = 180;
  const blockH = 60;
  const x = paperW - config.margins.right - blockW;
  const y = paperH - config.margins.bottom - blockH;

  return `
<g id="title-block">
  <rect x="${x}" y="${y}" width="${blockW}" height="${blockH}" fill="white" stroke="black" stroke-width="0.5"/>
  <line x1="${x}" y1="${y + 15}" x2="${x + blockW}" y2="${y + 15}" stroke="black" stroke-width="0.35"/>
  <line x1="${x}" y1="${y + 30}" x2="${x + blockW}" y2="${y + 30}" stroke="black" stroke-width="0.35"/>
  <line x1="${x}" y1="${y + 45}" x2="${x + blockW}" y2="${y + 45}" stroke="black" stroke-width="0.35"/>
  <line x1="${x + 90}" y1="${y + 30}" x2="${x + 90}" y2="${y + blockH}" stroke="black" stroke-width="0.35"/>

  <text x="${x + blockW / 2}" y="${y + 11}" text-anchor="middle" font-size="10" font-weight="bold" font-family="Arial">${escapeXml(tb.company)}</text>
  <text x="${x + blockW / 2}" y="${y + 25}" text-anchor="middle" font-size="8" font-family="Arial">${escapeXml(tb.projectName)} — ${escapeXml(tb.projectNumber)}</text>

  <text x="${x + 5}" y="${y + 40}" font-size="7" font-family="Arial">Sheet: ${escapeXml(tb.sheetNumber)}</text>
  <text x="${x + 5}" y="${y + 55}" font-size="7" font-family="Arial">Drawn: ${escapeXml(tb.drawnBy)}</text>

  <text x="${x + 95}" y="${y + 40}" font-size="7" font-family="Arial">Scale: 1:${config.scale}</text>
  <text x="${x + 95}" y="${y + 55}" font-size="7" font-family="Arial">Date: ${escapeXml(tb.date)}</text>

  <text x="${x + blockW / 2}" y="${y + blockH - 3}" text-anchor="middle" font-size="9" font-weight="bold" font-family="Arial">${escapeXml(tb.sheetTitle)}</text>
</g>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN SHEET GENERATION API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a complete sheet with one or more views.
 */
export function generateSheet(
  elements: BIMSolid[],
  config: SheetConfig,
  views: ViewOnSheet[],
): Sheet {
  const paperDef = PAPER_SIZES[config.paperSize];
  const paperW = config.orientation === 'landscape' ? paperDef.width : paperDef.height;
  const paperH = config.orientation === 'landscape' ? paperDef.height : paperDef.width;

  const svgParts: string[] = [];

  // SVG header
  svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paperW} ${paperH}" width="${paperW}mm" height="${paperH}mm">`);
  svgParts.push(`<style>text { user-select: none; }</style>`);

  // Sheet border
  svgParts.push(`<rect x="${config.margins.left}" y="${config.margins.top}" width="${paperW - config.margins.left - config.margins.right}" height="${paperH - config.margins.top - config.margins.bottom}" fill="white" stroke="black" stroke-width="0.7"/>`);

  // Render each view
  for (const viewOnSheet of views) {
    const vc = viewOnSheet.viewConfig;

    // Filter elements
    let viewElements = elements;
    if (vc.elementFilter) {
      viewElements = elements.filter(el => {
        if (vc.elementFilter!.types && !vc.elementFilter!.types.includes(el.type)) return false;
        if (vc.elementFilter!.categories && !vc.elementFilter!.categories.includes(el.category)) return false;
        if (vc.elementFilter!.worksets && el.workset && !vc.elementFilter!.worksets.includes(el.workset.worksetId)) return false;
        return true;
      });
    }

    // Filter by storey for plan views
    if (vc.type === 'plan' && vc.storey) {
      viewElements = viewElements.filter(el => el.storey === vc.storey);
    }

    let projectedView: ProjectedView;

    switch (vc.type) {
      case 'plan': {
        const storeyEl = viewElements.find(e => e.storey === vc.storey);
        const elevation = storeyEl?.elevation || 0;
        projectedView = projectPlanView(viewElements, elevation, vc.cutHeight || 1.2, vc.lineWeights);
        break;
      }
      case 'section': {
        const start = vc.sectionLine?.start || vec2(0, 0);
        const end = vc.sectionLine?.end || vec2(10, 0);
        projectedView = projectSectionView(viewElements, start, end, vc.viewDepth || 20, vc.lineWeights);
        break;
      }
      case 'elevation': {
        projectedView = projectElevationView(viewElements, vc.direction, vc.lineWeights);
        break;
      }
      default:
        projectedView = { lines: [], labels: [], hatches: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
    }

    // Clip viewport
    const clipId = `clip-${Math.random().toString(36).slice(2, 8)}`;
    svgParts.push(`<defs><clipPath id="${clipId}"><rect x="${viewOnSheet.position.x}" y="${viewOnSheet.position.y}" width="${viewOnSheet.width}" height="${viewOnSheet.height}"/></clipPath></defs>`);
    svgParts.push(`<g clip-path="url(#${clipId})">`);

    // Viewport border
    svgParts.push(`<rect x="${viewOnSheet.position.x}" y="${viewOnSheet.position.y}" width="${viewOnSheet.width}" height="${viewOnSheet.height}" fill="white" stroke="#CCCCCC" stroke-width="0.25"/>`);

    // Render view content
    svgParts.push(renderViewToSVG(
      projectedView,
      viewOnSheet.position.x,
      viewOnSheet.position.y,
      viewOnSheet.width,
      viewOnSheet.height,
      config.scale,
      vc.showDimensions,
      vc.showAnnotations,
    ));

    svgParts.push('</g>');

    // View title
    svgParts.push(`<text x="${viewOnSheet.position.x + viewOnSheet.width / 2}" y="${viewOnSheet.position.y + viewOnSheet.height + 8}" text-anchor="middle" font-size="8" font-weight="bold" font-family="Arial">${vc.type.toUpperCase()} — ${vc.storey || vc.direction || ''}</text>`);
  }

  // Title block
  svgParts.push(renderTitleBlock(config, paperW, paperH));

  svgParts.push('</svg>');

  return {
    id: `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    config,
    views,
    svg: svgParts.join('\n'),
  };
}

/**
 * Generate a standard set of sheets for a project.
 * Creates: one plan per storey + one building section + four elevations.
 */
export function generateStandardSheetSet(
  elements: BIMSolid[],
  projectName: string,
  projectNumber: string,
  storeys: Array<{ name: string; elevation: number }>,
): Sheet[] {
  const sheets: Sheet[] = [];
  const defaultLineWeights = { ...DEFAULT_LINE_WEIGHTS };

  const baseTitleBlock: TitleBlock = {
    projectName,
    projectNumber,
    sheetTitle: '',
    sheetNumber: '',
    drawnBy: 'PROIE AutoDraft',
    checkedBy: '',
    date: new Date().toISOString().split('T')[0],
    revision: 'A',
    company: 'EstimatorPro',
  };

  const defaultConfig: SheetConfig = {
    paperSize: 'A1',
    orientation: 'landscape',
    scale: 100,
    titleBlock: baseTitleBlock,
    margins: { top: 10, bottom: 10, left: 20, right: 10 },
  };

  // Floor plans
  for (let si = 0; si < storeys.length; si++) {
    const storey = storeys[si];
    const sheetNum = `A${(si + 1).toString().padStart(2, '0')}1`;

    sheets.push(generateSheet(elements, {
      ...defaultConfig,
      titleBlock: {
        ...baseTitleBlock,
        sheetTitle: `Floor Plan — ${storey.name}`,
        sheetNumber: sheetNum,
      },
    }, [{
      viewConfig: {
        type: 'plan',
        direction: 'top',
        storey: storey.name,
        cutHeight: 1.2,
        showGrid: true,
        showDimensions: true,
        showAnnotations: true,
        showHatching: true,
        showRoomLabels: true,
        lineWeights: defaultLineWeights,
      },
      position: vec2(30, 20),
      width: 780,
      height: 540,
    }]));
  }

  // Building section
  const allBounds = elements.reduce(
    (acc, el) => ({
      minX: Math.min(acc.minX, el.boundingBox.min.x),
      maxX: Math.max(acc.maxX, el.boundingBox.max.x),
      minY: Math.min(acc.minY, el.boundingBox.min.y),
      maxY: Math.max(acc.maxY, el.boundingBox.max.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );

  const midY = (allBounds.minY + allBounds.maxY) / 2;

  sheets.push(generateSheet(elements, {
    ...defaultConfig,
    titleBlock: {
      ...baseTitleBlock,
      sheetTitle: 'Building Section A-A',
      sheetNumber: 'S001',
    },
  }, [{
    viewConfig: {
      type: 'section',
      direction: 'custom',
      sectionLine: { start: vec2(allBounds.minX - 1, midY), end: vec2(allBounds.maxX + 1, midY) },
      viewDepth: 30,
      showGrid: true,
      showDimensions: true,
      showAnnotations: true,
      showHatching: true,
      showRoomLabels: false,
      lineWeights: defaultLineWeights,
    },
    position: vec2(30, 20),
    width: 780,
    height: 540,
  }]));

  // Four elevations
  const elevDirections: ViewDirection[] = ['north', 'south', 'east', 'west'];
  for (let ei = 0; ei < elevDirections.length; ei++) {
    sheets.push(generateSheet(elements, {
      ...defaultConfig,
      titleBlock: {
        ...baseTitleBlock,
        sheetTitle: `${elevDirections[ei].charAt(0).toUpperCase() + elevDirections[ei].slice(1)} Elevation`,
        sheetNumber: `E00${ei + 1}`,
      },
    }, [{
      viewConfig: {
        type: 'elevation',
        direction: elevDirections[ei],
        showGrid: false,
        showDimensions: true,
        showAnnotations: true,
        showHatching: false,
        showRoomLabels: false,
        lineWeights: defaultLineWeights,
      },
      position: vec2(30, 20),
      width: 780,
      height: 540,
    }]));
  }

  return sheets;
}
