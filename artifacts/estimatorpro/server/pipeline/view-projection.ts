// server/pipeline/view-projection.ts
// Projects 3D model elements back to 2D for verification against drawings.
// Supports plan views (horizontal cut) and section views (vertical cut).

export type ViewType = 'plan' | 'section' | 'elevation' | 'detail';

export interface ViewDefinition {
  type: ViewType;
  name: string;
  // Plan: horizontal cut at elevation
  cutElevation_m?: number;  // Z height of cut plane
  viewDepth_m?: number;     // how far below cut plane to show
  // Section/elevation: vertical cut along a line
  cutLine?: { start: { x: number; y: number }; end: { x: number; y: number } };
  cutDepth_m?: number;
}

export interface Projected2DElement {
  elementId: string;
  elementType: string;
  outline: Array<{ x: number; y: number }>;  // 2D polygon/polyline
  centroid: { x: number; y: number };
  width: number;
  height: number;  // in the 2D projection plane
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers: extract element geometry from DB format
// ---------------------------------------------------------------------------

interface ElementGeom {
  elementId: string;
  elementType: string;
  location: { x: number; y: number; z: number };
  rotation?: number;
  dimensions: { length: number; width: number; height: number };
  properties: Record<string, unknown>;
  baseElevation: number;
  topElevation: number;
  gridStart?: { alpha: string; numeric: string } | null;
  gridEnd?: { alpha: string; numeric: string } | null;
}

function parseElement(el: Record<string, unknown>): ElementGeom | null {
  let loc = { x: 0, y: 0, z: 0 };
  let rotation = 0;
  let dims = { length: 1, width: 0.2, height: 3 };

  // Parse location
  const rawLocation = el.location;
  if (typeof rawLocation === 'string') {
    try {
      const parsed = JSON.parse(rawLocation);
      if (parsed.realLocation) {
        loc = {
          x: Number(parsed.realLocation.x) || 0,
          y: Number(parsed.realLocation.y) || 0,
          z: Number(parsed.realLocation.z) || 0,
        };
      }
      if (typeof parsed.rotation === 'number') rotation = parsed.rotation;
    } catch { /* use defaults */ }
  } else if (rawLocation && typeof rawLocation === 'object') {
    const rl = rawLocation as Record<string, unknown>;
    if (rl.realLocation && typeof rl.realLocation === 'object') {
      const r = rl.realLocation as Record<string, unknown>;
      loc = { x: Number(r.x) || 0, y: Number(r.y) || 0, z: Number(r.z) || 0 };
    }
    if (typeof rl.rotation === 'number') rotation = rl.rotation;
  }

  // Parse geometry/dimensions
  const rawGeom = el.geometry;
  if (typeof rawGeom === 'string') {
    try {
      const parsed = JSON.parse(rawGeom);
      if (parsed.dimensions) {
        dims = {
          length: Number(parsed.dimensions.length) || 0,
          width: Number(parsed.dimensions.width) || 0,
          height: Number(parsed.dimensions.height) || 0,
        };
      }
    } catch { /* use defaults */ }
  } else if (rawGeom && typeof rawGeom === 'object') {
    const g = rawGeom as Record<string, unknown>;
    if (g.dimensions && typeof g.dimensions === 'object') {
      const d = g.dimensions as Record<string, unknown>;
      dims = {
        length: Number(d.length) || 0,
        width: Number(d.width) || 0,
        height: Number(d.height) || 0,
      };
    }
  }

  // Parse properties
  let props: Record<string, unknown> = {};
  const rawProps = el.properties;
  if (typeof rawProps === 'string') {
    try { props = JSON.parse(rawProps); } catch { /* empty */ }
  } else if (rawProps && typeof rawProps === 'object') {
    props = rawProps as Record<string, unknown>;
  }

  const baseZ = loc.z;
  const topZ = baseZ + dims.height;

  return {
    elementId: String(el.elementId || el.id || ''),
    elementType: String(el.elementType || el.type || 'unknown'),
    location: loc,
    rotation,
    dimensions: dims,
    properties: props,
    baseElevation: baseZ,
    topElevation: topZ,
  };
}

// ---------------------------------------------------------------------------
// Plan projection: horizontal cut at a given elevation
// ---------------------------------------------------------------------------

/**
 * Project 3D elements onto a plan view by taking a horizontal cut.
 * Elements are included if their base elevation is at or below the cut
 * elevation and their top elevation is above the cut elevation.
 */
export function projectToPlan(
  elements: Record<string, unknown>[],
  cutElevation_m: number,
  viewDepth_m: number,
): Projected2DElement[] {
  const results: Projected2DElement[] = [];
  const minZ = cutElevation_m - viewDepth_m;

  for (const raw of elements) {
    const el = parseElement(raw);
    if (!el) continue;

    // Filter: element must intersect the cut range [minZ, cutElevation]
    if (el.baseElevation > cutElevation_m) continue;
    if (el.topElevation < minZ) continue;

    const projected = projectElementXY(el);
    if (projected) results.push(projected);
  }

  return results;
}

/**
 * Project an element to its XY footprint (plan view).
 */
function projectElementXY(el: ElementGeom): Projected2DElement | null {
  const { location, dimensions, elementType, elementId, properties } = el;
  const rotation = el.rotation ?? 0;
  const halfL = dimensions.length / 2;
  const halfW = dimensions.width / 2;

  let outline: Array<{ x: number; y: number }>;

  if (elementType === 'wall') {
    // Walls are defined by start/end + thickness.
    // Location is the midpoint; rotation gives direction.
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Rectangle: length along wall direction, width perpendicular
    outline = [
      { x: location.x + (-halfL) * cos - (-halfW) * sin, y: location.y + (-halfL) * sin + (-halfW) * cos },
      { x: location.x + (halfL) * cos - (-halfW) * sin,  y: location.y + (halfL) * sin + (-halfW) * cos },
      { x: location.x + (halfL) * cos - (halfW) * sin,   y: location.y + (halfL) * sin + (halfW) * cos },
      { x: location.x + (-halfL) * cos - (halfW) * sin,  y: location.y + (-halfL) * sin + (halfW) * cos },
    ];
  } else if (elementType === 'column') {
    // Columns: rectangular or square footprint centered at location
    outline = [
      { x: location.x - halfL, y: location.y - halfW },
      { x: location.x + halfL, y: location.y - halfW },
      { x: location.x + halfL, y: location.y + halfW },
      { x: location.x - halfL, y: location.y + halfW },
    ];
  } else if (elementType === 'door' || elementType === 'window') {
    // Doors/windows: thin rectangle in the wall plane
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    outline = [
      { x: location.x + (-halfL) * cos, y: location.y + (-halfL) * sin },
      { x: location.x + (halfL) * cos,  y: location.y + (halfL) * sin },
      { x: location.x + (halfL) * cos - (halfW) * sin,  y: location.y + (halfL) * sin + (halfW) * cos },
      { x: location.x + (-halfL) * cos - (halfW) * sin, y: location.y + (-halfL) * sin + (halfW) * cos },
    ];
  } else if (elementType === 'slab') {
    // Slabs may have a boundary polygon in properties
    const boundary = properties.boundary_m;
    if (Array.isArray(boundary) && boundary.length >= 3) {
      outline = boundary.map((p: unknown) => {
        const pt = p as { x: number; y: number };
        return { x: Number(pt.x) || 0, y: Number(pt.y) || 0 };
      });
    } else {
      // Fallback to rectangle centered on location
      outline = [
        { x: location.x - halfL, y: location.y - halfW },
        { x: location.x + halfL, y: location.y - halfW },
        { x: location.x + halfL, y: location.y + halfW },
        { x: location.x - halfL, y: location.y + halfW },
      ];
    }
  } else {
    // Generic: axis-aligned rectangle
    outline = [
      { x: location.x - halfL, y: location.y - halfW },
      { x: location.x + halfL, y: location.y - halfW },
      { x: location.x + halfL, y: location.y + halfW },
      { x: location.x - halfL, y: location.y + halfW },
    ];
  }

  if (outline.length < 3) return null;

  // Compute centroid
  let cx = 0, cy = 0;
  for (const p of outline) { cx += p.x; cy += p.y; }
  cx /= outline.length;
  cy /= outline.length;

  // Compute bounding box dimensions in 2D
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    elementId,
    elementType,
    outline,
    centroid: { x: cx, y: cy },
    width: maxX - minX,
    height: maxY - minY,
    properties,
  };
}

// ---------------------------------------------------------------------------
// Section projection: vertical cut along a line
// ---------------------------------------------------------------------------

/**
 * Project 3D elements onto a section view defined by a vertical cut line.
 * The cut line is defined in the XY plane. Elements within cutDepth_m of
 * the cut plane are included. The output 2D coordinates use:
 *   X = distance along the cut line
 *   Y = Z elevation
 */
export function projectToSection(
  elements: Record<string, unknown>[],
  cutLine: { start: { x: number; y: number }; end: { x: number; y: number } },
  cutDepth_m: number,
): Projected2DElement[] {
  const results: Projected2DElement[] = [];

  // Cut line direction and length
  const dx = cutLine.end.x - cutLine.start.x;
  const dy = cutLine.end.y - cutLine.start.y;
  const lineLen = Math.sqrt(dx * dx + dy * dy);
  if (lineLen < 1e-6) return results;

  // Unit tangent and normal for the cut line
  const tx = dx / lineLen;
  const ty = dy / lineLen;
  const nx = -ty;  // perpendicular (inward direction)
  const ny = tx;

  for (const raw of elements) {
    const el = parseElement(raw);
    if (!el) continue;

    // Compute signed distance from element center to the cut line
    const relX = el.location.x - cutLine.start.x;
    const relY = el.location.y - cutLine.start.y;
    const perpDist = relX * nx + relY * ny;

    // Element must be within cutDepth of the cut plane
    // Also consider element width — use half of the larger dimension as tolerance
    const halfSpan = Math.max(el.dimensions.length, el.dimensions.width) / 2;
    if (Math.abs(perpDist) > cutDepth_m + halfSpan) continue;

    // Project element center onto the cut line (parameter along the line)
    const tangDist = relX * tx + relY * ty;

    // Build 2D outline in section space: X = distance along cut, Y = Z
    const halfL = el.dimensions.length / 2;
    const sectionWidth = halfL;  // projected width along cut line
    const baseZ = el.baseElevation;
    const topZ = el.topElevation;

    const outline: Array<{ x: number; y: number }> = [
      { x: tangDist - sectionWidth, y: baseZ },
      { x: tangDist + sectionWidth, y: baseZ },
      { x: tangDist + sectionWidth, y: topZ },
      { x: tangDist - sectionWidth, y: topZ },
    ];

    const centroid = { x: tangDist, y: (baseZ + topZ) / 2 };

    results.push({
      elementId: el.elementId,
      elementType: el.elementType,
      outline,
      centroid,
      width: sectionWidth * 2,
      height: topZ - baseZ,
      properties: el.properties,
    });
  }

  return results;
}
