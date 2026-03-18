/**
 * THE MOORINGS — Cameron Lake, Ontario
 * Gridline geometry constants derived from drawing A101 R1 (Underground Parking Plan 1)
 *
 * Origin: Grid A = EW 0 m, Grid 9 = NS 0 m.
 * Convention used by viewer-3d.tsx:
 *   axis='X'  NS-running lines (A–L, CLa/CL/CLb, M–Y)
 *     coord  = EW position at NS=0 (grid 9)
 *     start_m = NS of southern boundary (negative = south of grid 9)
 *     end_m   = NS of northern boundary
 *     angle_deg = clockwise from NS towards east; EW shifts by tan(angle) per metre of NS
 *
 *   axis='Y'  EW-running lines (1–9, 10–19)
 *     coord  = NS position at EW = start_m
 *     start_m = EW of western boundary
 *     end_m   = EW of eastern boundary
 *     angle_deg = same convention; NS shifts by −tan(angle) per metre of EW east of start_m
 *
 * Wing angle: 27.16° (two 13.58° turns from bearing 166.42°)
 * CL angle  : 13.58° (single transition turn)
 *
 * Key anchor dimensions (all metres):
 *   Grid 9  NS = 0       (south NS reference)
 *   Grid 1  NS = 40.830  (north NS reference, rectangular block)
 *   Grid A  EW = 0       (west EW reference)
 *   Grid L  EW = 41.999  (east EW reference, rectangular block)
 *   Grid M  EW = 45.671  (at NS=0, wing western boundary)
 *   Grid Y  EW = 87.472  (at NS=0, wing eastern boundary)
 *   Grid 10 NS = +14.819 (at EW=45.671, wing northern boundary)
 *   Grid 19 NS = −30.088 (southern wing boundary; used as start_m for M–Y and CL lines)
 */

export interface GridlineDefinition {
  label: string;
  axis: 'X' | 'Y';
  coord: number;
  start_m: number;
  end_m: number;
  angle_deg: number;
}

const RECT_NS_START = 0;       // Grid 9 NS (south bound of rectangular block)
const RECT_NS_END   = 40.830;  // Grid 1 NS (north bound of rectangular block)
const RECT_EW_START = 0;       // Grid A EW (west bound of rectangular block)
const RECT_EW_END   = 41.999;  // Grid L EW (east bound of rectangular block)

const WING_ANG  = 27.16;  // degrees — M–Y and 10–19 families
const CL_ANG    = 13.58;  // degrees — CLa / CL / CLb transition lines

const WING_NS_S = -30.088; // Grid 19 NS (southern wing boundary)
const WING_NS_N =  14.819; // Grid 10 NS at EW=M (northern wing boundary)
const WING_EW_W =  45.671; // Grid M EW at NS=0  (western wing boundary)
const WING_EW_E =  87.472; // Grid Y EW at NS=0  (eastern wing boundary)

// CL lines extend from the wing south boundary up through the rectangular block north boundary
const CL_NS_START = WING_NS_S;
const CL_NS_END   = RECT_NS_END;

export const MOORINGS_GRIDLINES: GridlineDefinition[] = [
  // ── Rectangular EW-position lines (A–L) ─────────────────────────────────
  // axis='X': run north-south at fixed EW; span the full rectangular NS extent
  { label: 'A',  axis: 'X', coord:  0,      start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'B',  axis: 'X', coord:  4.710,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'C',  axis: 'X', coord:  8.199,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'D',  axis: 'X', coord: 12.553,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'E',  axis: 'X', coord: 15.099,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'F',  axis: 'X', coord: 19.149,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'G',  axis: 'X', coord: 21.450,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'Ga', axis: 'X', coord: 22.199,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'H',  axis: 'X', coord: 29.049,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'J',  axis: 'X', coord: 32.100,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'K',  axis: 'X', coord: 38.949,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },
  { label: 'L',  axis: 'X', coord: 41.999,  start_m: RECT_NS_START, end_m: RECT_NS_END, angle_deg: 0 },

  // ── CL transition lines (CLa / CL / CLb) ────────────────────────────────
  // axis='X': angled 13.58°; bridge rectangular block and wing
  { label: 'CLa', axis: 'X', coord: 52.786, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CL',  axis: 'X', coord: 56.071, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CLb', axis: 'X', coord: 59.356, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },

  // ── Wing EW-position lines (M–Y) ────────────────────────────────────────
  // axis='X': angled 27.16°; coord = EW at NS=0 (grid 9 level); span grid 19 → grid 10
  { label: 'M',  axis: 'X', coord: 45.671, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'N',  axis: 'X', coord: 49.054, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'P',  axis: 'X', coord: 50.956, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'Q',  axis: 'X', coord: 55.371, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'R',  axis: 'X', coord: 58.551, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'S',  axis: 'X', coord: 65.272, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'Sa', axis: 'X', coord: 66.021, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'T',  axis: 'X', coord: 68.322, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'U',  axis: 'X', coord: 72.372, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'V',  axis: 'X', coord: 74.918, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'W',  axis: 'X', coord: 79.272, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'X',  axis: 'X', coord: 82.761, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },
  { label: 'Y',  axis: 'X', coord: 87.472, start_m: WING_NS_S, end_m: WING_NS_N, angle_deg: WING_ANG },

  // ── Rectangular NS-position lines (9–1, south→north) ────────────────────
  // axis='Y': run east-west at fixed NS; span the full rectangular EW extent (A→L)
  { label: '9', axis: 'Y', coord:  0,      start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '8', axis: 'Y', coord:  5.885,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '7', axis: 'Y', coord:  8.244,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '6', axis: 'Y', coord: 14.850,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '5', axis: 'Y', coord: 21.830,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '4', axis: 'Y', coord: 26.030,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '3', axis: 'Y', coord: 27.876,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '2', axis: 'Y', coord: 37.355,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },
  { label: '1', axis: 'Y', coord: 40.830,  start_m: RECT_EW_START, end_m: RECT_EW_END, angle_deg: 0 },

  // ── Wing NS-position lines (10–19, north→south) ──────────────────────────
  // axis='Y': angled 27.16°; coord = NS at EW=WING_EW_W (M line); span M→Y in EW
  { label: '10', axis: 'Y', coord:  14.819, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '11', axis: 'Y', coord:  11.344, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '12', axis: 'Y', coord:   6.594, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '13', axis: 'Y', coord:   1.865, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '14', axis: 'Y', coord:  -2.335, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '15', axis: 'Y', coord:  -9.315, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '16', axis: 'Y', coord: -15.921, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '17', axis: 'Y', coord: -18.280, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '18', axis: 'Y', coord: -20.379, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
  { label: '19', axis: 'Y', coord: -27.552, start_m: WING_EW_W, end_m: WING_EW_E, angle_deg: WING_ANG },
];

/**
 * Compute the intersection point of two gridlines (one alpha, one numeric).
 * Returns the real-world (EW, NS) coordinates where the two lines cross.
 *
 * For straight grids (angle=0): intersection is simply (alpha.coord, numeric.coord).
 * For angled grids: the intersection requires solving two parametric line equations.
 *
 * Alpha gridline (axis='X'): EW = coord + NS * tan(angle)
 *   → This is a line in (EW, NS) space: EW = alpha.coord + NS * tan(alpha.angle)
 *
 * Numeric gridline (axis='Y'): NS = coord - (EW - start_m) * tan(angle)
 *   → Rearranged: NS = coord - EW * tan(numeric.angle) + start_m * tan(numeric.angle)
 *
 * Solving simultaneously gives the intersection.
 */
/**
 * Generic grid intersection — works for ANY project's gridlines.
 * Pass the gridline array explicitly, or omit to use MOORINGS_GRIDLINES as default.
 */
export function computeGridIntersection(
  alphaLabel: string,
  numericLabel: string,
  gridlines: GridlineDefinition[] = MOORINGS_GRIDLINES,
): { ew: number; ns: number } | null {
  const alpha = gridlines.find(
    g => g.axis === 'X' && g.label.toUpperCase() === alphaLabel.toUpperCase()
  );
  const numeric = gridlines.find(
    g => g.axis === 'Y' && g.label.toUpperCase() === numericLabel.toUpperCase()
  );

  if (!alpha || !numeric) return null;

  const tanAlpha = Math.tan(alpha.angle_deg * (Math.PI / 180));
  const tanNumeric = Math.tan(numeric.angle_deg * (Math.PI / 180));

  // Alpha line: EW = alpha.coord + NS * tanAlpha
  // Numeric line: NS = numeric.coord - (EW - numeric.start_m) * tanNumeric
  //             = numeric.coord - EW * tanNumeric + numeric.start_m * tanNumeric

  // Substituting alpha into numeric:
  // NS = numeric.coord - (alpha.coord + NS * tanAlpha) * tanNumeric + numeric.start_m * tanNumeric
  // NS = numeric.coord - alpha.coord * tanNumeric - NS * tanAlpha * tanNumeric + numeric.start_m * tanNumeric
  // NS + NS * tanAlpha * tanNumeric = numeric.coord - alpha.coord * tanNumeric + numeric.start_m * tanNumeric
  // NS * (1 + tanAlpha * tanNumeric) = numeric.coord + (numeric.start_m - alpha.coord) * tanNumeric
  // NS = (numeric.coord + (numeric.start_m - alpha.coord) * tanNumeric) / (1 + tanAlpha * tanNumeric)

  const denom = 1 + tanAlpha * tanNumeric;
  if (Math.abs(denom) < 1e-10) return null; // Parallel lines — no intersection

  const ns = (numeric.coord + (numeric.start_m - alpha.coord) * tanNumeric) / denom;
  const ew = alpha.coord + ns * tanAlpha;

  return { ew, ns };
}

/**
 * Look up a gridline definition by label.
 */
export function getGridline(label: string, gridlines: GridlineDefinition[] = MOORINGS_GRIDLINES): GridlineDefinition | undefined {
  return gridlines.find(
    g => g.label.toUpperCase() === label.toUpperCase()
  );
}

/**
 * Returns a map of label → computed 3D endpoints (in Three.js space).
 * Three.js: X = east, Y = elevation (pass floorY), Z = north.
 *
 * Usage:
 *   const ep = computeGridEndpoints(floorY);
 *   ep.get('M') → { pt1: Vector3, pt2: Vector3 }
 */
export function computeGridEndpoints(
  floorY: number
): Map<string, { pt1: [number, number, number]; pt2: [number, number, number] }> {
  const map = new Map<string, { pt1: [number, number, number]; pt2: [number, number, number] }>();
  for (const g of MOORINGS_GRIDLINES) {
    const tanA = Math.tan(g.angle_deg * (Math.PI / 180));
    let pt1: [number, number, number];
    let pt2: [number, number, number];
    if (g.axis === 'X') {
      pt1 = [g.coord + g.start_m * tanA, floorY, g.start_m];
      pt2 = [g.coord + g.end_m   * tanA, floorY, g.end_m];
    } else {
      pt1 = [g.start_m, floorY, g.coord];
      pt2 = [g.end_m,   floorY, g.coord - (g.end_m - g.start_m) * tanA];
    }
    map.set(g.label, { pt1, pt2 });
  }
  return map;
}
