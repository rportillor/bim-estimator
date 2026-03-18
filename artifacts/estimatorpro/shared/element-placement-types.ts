/**
 * Element Placement Record — the master coordinate + property table.
 *
 * Every building element is stored as a record with:
 * - 3D coordinates (start, end, centerline) from grid intersections
 * - Properties (thickness, height, width) from correlated documents
 * - Verification chain (parser → AI visual → user confirmed)
 *
 * CONVENTIONS:
 * - Origin (0,0,0) = bottom-left corner of the building (leftmost + lowest gridline intersection)
 * - Start/End ordering: always LEFT to RIGHT, CLOCKWISE around the building
 * - Z coordinate = field elevation (real-world position for construction layout)
 * - height_m = estimation height (may differ from Z — used for cost calculation)
 * - Thickness/width/height come from CORRELATED DOCUMENTS (assemblies, schedules, sections)
 *   NOT from the floor plan
 */

// ---------------------------------------------------------------------------
// Grid Intersection Coordinate
// ---------------------------------------------------------------------------

export interface GridIntersectionCoord {
  /** Grid labels at this intersection (e.g., "A" + "9") */
  alpha_label: string;
  numeric_label: string;
  /** Computed 3D coordinate */
  x: number;  // EW position (metres)
  y: number;  // NS position (metres)
  z: number;  // Field elevation (metres) — real-world height for construction layout
  /** How this coordinate was determined */
  source: 'computed_from_grid' | 'parsed_from_pdf' | 'user_override';
  /** Whether the coordinate has been verified */
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Grid Coordinate Table — all intersections for a project
// ---------------------------------------------------------------------------

export interface GridCoordinateTable {
  /** Project identifier */
  projectId: string;
  /** Origin intersection (bottom-left corner) */
  origin: {
    alpha_label: string;
    numeric_label: string;
    description: string;
  };
  /** All computed grid intersections */
  intersections: GridIntersectionCoord[];
  /** Verification status */
  verification: {
    parser_computed: boolean;
    ai_visual_checked: boolean;
    user_confirmed: boolean;
    confirmed_at?: string;
    discrepancies: string[];
  };
}

// ---------------------------------------------------------------------------
// Element Placement Record
// ---------------------------------------------------------------------------

export interface ElementPlacementRecord {
  /** Unique element identifier */
  element_id: string;

  /** Element type: wall, door, window, column, beam, slab, pipe, conduit,
   *  switch, outlet, sprinkler, diffuser, light, receptacle, etc. */
  type: string;

  /** Floor level */
  storey: string;

  // ── Grid References ──────────────────────────────────────────────────
  /** Grid intersection at the START of the element (e.g., "A-9") */
  grid_start: string;
  /** Grid intersection at the END of the element (e.g., "A-2") */
  grid_end: string;

  // ── 3D Coordinates ───────────────────────────────────────────────────
  /** Start point — always the LEFT or BOTTOM point (left-to-right, clockwise convention) */
  start_coord: { x: number; y: number; z: number };
  /** End point — always the RIGHT or TOP point */
  end_coord: { x: number; y: number; z: number };
  /** Centerline position — midpoint of start and end */
  centerline: { x: number; y: number; z: number };

  // ── Geometric Properties ─────────────────────────────────────────────
  /** Perpendicular offset from grid line to element centerline (metres) */
  offset_from_grid_m: number;
  /** Rotation from the grid axis in degrees.
   *  0 = parallel to grid, 90 = perpendicular, 13.58 = angled wing, etc. */
  angle_rotation_deg: number;

  // ── Dimensions (from CORRELATED DOCUMENTS — not from floor plan) ────
  /** Wall/element thickness from construction assembly details (mm) */
  thickness_mm: number | null;
  /** Height for estimation calculation — may differ from Z (metres).
   *  Comes from building sections, ceiling heights, storey data. */
  height_m: number | null;
  /** Width for doors/windows from schedule (mm) */
  width_mm: number | null;
  /** Depth for beams, slabs from structural sections (mm) */
  depth_mm: number | null;

  // ── Identity & References ────────────────────────────────────────────
  /** Assembly/type code from drawings (e.g., EW1, IW3D, F1a) — links to assembly details */
  assembly_code: string | null;
  /** Instance mark from floor plan (e.g., D101, W201) — links to schedule */
  mark: string | null;
  /** Material from specifications or assembly details */
  material: string | null;
  /** Fire rating from assembly details or specifications */
  fire_rating: string | null;

  // ── Convention & Direction ───────────────────────────────────────────
  /** Element direction convention: start→end is always left-to-right or clockwise.
   *  This determines which side is interior vs exterior for thickness offset. */
  direction: 'left_to_right' | 'clockwise';

  // ── Source & Verification ────────────────────────────────────────────
  /** Which documents this information was correlated from */
  source_documents: Array<{
    document_name: string;
    page?: number;
    what_was_extracted: string;  // "wall position", "door size", "assembly layers", etc.
  }>;
  /** Verification level */
  verified_by: 'parser' | 'ai_visual' | 'user_confirmed';
  /** Notes, discrepancies, RFIs */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Element Placement Table — all elements for a floor
// ---------------------------------------------------------------------------

export interface ElementPlacementTable {
  projectId: string;
  storey: string;
  /** The grid coordinate table this placement is based on */
  grid_table_id: string;
  /** All elements on this floor */
  elements: ElementPlacementRecord[];
  /** Summary statistics */
  summary: {
    total_elements: number;
    by_type: Record<string, number>;
    verified_count: number;
    unverified_count: number;
    rfi_count: number;
  };
}

// ---------------------------------------------------------------------------
// Helper: compute all grid intersections from gridline definitions
// ---------------------------------------------------------------------------

import { type GridlineDefinition, computeGridIntersection } from './grid-types';

/**
 * Compute ALL grid intersection coordinates from a set of gridline definitions.
 * Returns a GridCoordinateTable with every alpha×numeric intersection.
 *
 * @param gridlines - The full set of gridline definitions (from parser or constants)
 * @param floorElevation - Z elevation for this floor (metres)
 * @param projectId - Project identifier
 */
export function computeAllIntersections(
  gridlines: GridlineDefinition[],
  floorElevation: number,
  projectId: string,
): GridCoordinateTable {
  const alphas = gridlines.filter(g => g.axis === 'X');
  const numerics = gridlines.filter(g => g.axis === 'Y');

  const intersections: GridIntersectionCoord[] = [];

  for (const alpha of alphas) {
    for (const numeric of numerics) {
      const result = computeGridIntersection(alpha.label, numeric.label, gridlines);
      if (result) {
        intersections.push({
          alpha_label: alpha.label,
          numeric_label: numeric.label,
          x: Math.round(result.ew * 1000) / 1000,  // round to mm precision
          y: Math.round(result.ns * 1000) / 1000,
          z: floorElevation,
          source: 'computed_from_grid',
          verified: false,
        });
      }
    }
  }

  // Determine origin — the intersection with the smallest x and smallest y
  // (bottom-left corner)
  let originAlpha = alphas[0]?.label || '?';
  let originNumeric = numerics[0]?.label || '?';
  let originX = Infinity;
  let originY = Infinity;

  for (const inter of intersections) {
    // Bottom-left = smallest x, then smallest y
    if (inter.x < originX || (inter.x === originX && inter.y < originY)) {
      originX = inter.x;
      originY = inter.y;
      originAlpha = inter.alpha_label;
      originNumeric = inter.numeric_label;
    }
  }

  return {
    projectId,
    origin: {
      alpha_label: originAlpha,
      numeric_label: originNumeric,
      description: `Grid ${originAlpha} / Grid ${originNumeric} intersection (bottom-left corner)`,
    },
    intersections,
    verification: {
      parser_computed: true,
      ai_visual_checked: false,
      user_confirmed: false,
      discrepancies: [],
    },
  };
}

/**
 * Create an ElementPlacementRecord from grid references and correlated data.
 *
 * @param type - Element type
 * @param gridStart - Start grid intersection label (e.g., "A-9")
 * @param gridEnd - End grid intersection label (e.g., "A-2")
 * @param gridTable - The verified grid coordinate table
 * @param properties - Correlated properties from other documents
 */
export function createPlacementRecord(
  type: string,
  gridStart: string,
  gridEnd: string,
  gridTable: GridCoordinateTable,
  properties: {
    storey: string;
    offset_from_grid_m?: number;
    angle_rotation_deg?: number;
    thickness_mm?: number | null;
    height_m?: number | null;
    width_mm?: number | null;
    depth_mm?: number | null;
    assembly_code?: string | null;
    mark?: string | null;
    material?: string | null;
    fire_rating?: string | null;
    source_documents?: ElementPlacementRecord['source_documents'];
    notes?: string[];
  },
): ElementPlacementRecord | null {
  // Parse grid labels from "A-9" format
  const parseGridLabel = (label: string): { alpha: string; numeric: string } | null => {
    const parts = label.split('-');
    if (parts.length !== 2) return null;
    return { alpha: parts[0].trim(), numeric: parts[1].trim() };
  };

  const startRef = parseGridLabel(gridStart);
  const endRef = parseGridLabel(gridEnd);
  if (!startRef || !endRef) return null;

  // Look up coordinates from the grid table
  const startInter = gridTable.intersections.find(
    i => i.alpha_label.toUpperCase() === startRef.alpha.toUpperCase() &&
         i.numeric_label === startRef.numeric
  );
  const endInter = gridTable.intersections.find(
    i => i.alpha_label.toUpperCase() === endRef.alpha.toUpperCase() &&
         i.numeric_label === endRef.numeric
  );

  if (!startInter || !endInter) return null;

  // Ensure left-to-right / clockwise ordering
  let startCoord = { x: startInter.x, y: startInter.y, z: startInter.z };
  let endCoord = { x: endInter.x, y: endInter.y, z: endInter.z };
  let direction: 'left_to_right' | 'clockwise' = 'left_to_right';

  // If end is to the LEFT of start, swap for left-to-right convention
  if (endCoord.x < startCoord.x) {
    const temp = startCoord;
    startCoord = endCoord;
    endCoord = temp;
    direction = 'left_to_right';
  }

  const centerline = {
    x: (startCoord.x + endCoord.x) / 2,
    y: (startCoord.y + endCoord.y) / 2,
    z: (startCoord.z + endCoord.z) / 2,
  };

  return {
    element_id: `${type}-${gridStart}-${gridEnd}-${Date.now()}`,
    type,
    storey: properties.storey,
    grid_start: gridStart,
    grid_end: gridEnd,
    start_coord: startCoord,
    end_coord: endCoord,
    centerline,
    offset_from_grid_m: properties.offset_from_grid_m ?? 0,
    angle_rotation_deg: properties.angle_rotation_deg ?? 0,
    thickness_mm: properties.thickness_mm ?? null,
    height_m: properties.height_m ?? null,
    width_mm: properties.width_mm ?? null,
    depth_mm: properties.depth_mm ?? null,
    assembly_code: properties.assembly_code ?? null,
    mark: properties.mark ?? null,
    material: properties.material ?? null,
    fire_rating: properties.fire_rating ?? null,
    direction,
    source_documents: properties.source_documents ?? [],
    verified_by: 'parser',
    notes: properties.notes ?? [],
  };
}
