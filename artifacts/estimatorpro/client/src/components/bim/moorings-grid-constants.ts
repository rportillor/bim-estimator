/**
 * THE MOORINGS — Cameron Lake, Ontario
 * Gridline geometry constants derived from drawing A101 R1 (Underground Parking Plan 1)
 *
 * Origin: Grid A = EW 0 m, Grid 9 = NS 0 m.
 * Convention used by viewer-3d.tsx:
 *   axis='X'  NS-running lines (A–L, CLa/CL/CLb, M–Y)
 *     coord  = EW position at NS=0 (Grid 9)
 *     start_m = NS of southern boundary (negative = south of Grid 9)
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
 * Key anchor dimensions (all metres, measured from PDF A101):
 *   Grid 9  NS = 0         (south NS reference, origin)
 *   Grid 1  NS = 40.830    (north NS reference, rectangular block)
 *   Grid A  EW = 0         (west EW reference)
 *   Grid L  EW = 41.999    (east EW reference, rectangular block)
 *   Grid M  EW = 45.671    (at NS=0, wing western reference line)
 *   Grid Y  EW = 87.472    (at NS=0, wing eastern reference line)
 *
 * Wing boundary corners (intersections of outer grid lines):
 *   M×10 = (EW=51.689, NS=+11.731)   NW corner of wing
 *   Y×10 = (EW=84.781, NS= −5.245)   NE corner of wing
 *   M×19 = (EW=34.482, NS=−21.812)   SW corner of wing
 *   Y×19 = (EW=67.570, NS=−38.784)   SE corner of wing
 *
 * Wing line extents are bounded by Grid M (west), Grid Y (east),
 * Grid 10 (north) and Grid 19 (south) — not by fixed WING_NS/EW constants,
 * because the wing is a rotated rectangle and each line's extent shifts.
 *
 * STRICT RULE: no magic numbers outside this file.
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

// Reference EW coords for the wing (at NS=0 / Grid 9 level)
const WING_EW_W =  45.671; // Grid M EW at NS=0
const WING_EW_E =  87.472; // Grid Y EW at NS=0

// WING_NS_S is used as CL-line start (south end of the CL transition zone).
// It equals the NS of Grid 19 at Grid Sa's EW (~50.6 m), where the southern
// boundary of the wing passes.
const WING_NS_S = -30.088;
const WING_NS_N =  14.819; // Grid 10 NS at EW=45.671 (wing northern reference)

// CL lines extend from the wing south boundary up through the rectangular block north boundary
const CL_NS_START = WING_NS_S;
const CL_NS_END   = RECT_NS_END;

// ── How wing-line extents are computed ────────────────────────────────────
//
// Wing axis='X' lines (M–Y) run from their intersection with Grid 19 (south)
// to their intersection with Grid 10 (north).  Both Grid 10 and Grid 19 are
// angled, so the NS extent of each M–Y line is unique.
//
//   start_m_j = NS at (Grid_j × Grid_19)
//             = (−27.552 + (45.671 − coord_j) × tan27) / (1 + tan27²)
//             = (−4.123 − 0.5130 × coord_j) / 1.26317
//
//   end_m_j   = NS at (Grid_j × Grid_10)
//             = (14.819 + (45.671 − coord_j) × tan27) / (1 + tan27²)
//             = ( 38.248 − 0.5130 × coord_j) / 1.26317
//
// Wing axis='Y' lines (10–19) run from their intersection with Grid M (west)
// to their intersection with Grid Y (east).  coord is redefined as NS at
// the new start_m (= EW of the Grid M intersection).
//
//   start_m_i = EW at (Grid_i × Grid_M)
//             = 45.671 + orig_coord_i / 1.26317 × tan27
//             = 45.671 + orig_coord_i × 0.40625
//
//   coord_i   = NS at new start_m
//             = orig_coord_i / 1.26317
//
//   end_m_i   = EW at (Grid_i × Grid_Y)
//             = 87.472 + (orig_coord_i − 41.801 × tan27) / 1.26317 × tan27
//             = 87.472 + (orig_coord_i − 21.444) × 0.40625
//
// where orig_coord_i = original "NS at EW=45.671" measurement from A101.
// ──────────────────────────────────────────────────────────────────────────

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
  // axis='X': angled 27.16°; coord = EW at NS=0.
  // start_m = NS at intersection with Grid 19 (southern wing boundary).
  // end_m   = NS at intersection with Grid 10 (northern wing boundary).
  // Both are derived from: (±offset − 0.5130 × coord) / 1.26317
  { label: 'M',  axis: 'X', coord: 45.671, start_m: -21.812, end_m:  11.731, angle_deg: WING_ANG },
  { label: 'N',  axis: 'X', coord: 49.054, start_m: -23.186, end_m:  10.357, angle_deg: WING_ANG },
  { label: 'P',  axis: 'X', coord: 50.956, start_m: -23.958, end_m:   9.585, angle_deg: WING_ANG },
  { label: 'Q',  axis: 'X', coord: 55.371, start_m: -25.752, end_m:   7.792, angle_deg: WING_ANG },
  { label: 'R',  axis: 'X', coord: 58.551, start_m: -27.046, end_m:   6.501, angle_deg: WING_ANG },
  { label: 'S',  axis: 'X', coord: 65.272, start_m: -29.773, end_m:   3.772, angle_deg: WING_ANG },
  { label: 'Sa', axis: 'X', coord: 66.021, start_m: -30.078, end_m:   3.468, angle_deg: WING_ANG },
  { label: 'T',  axis: 'X', coord: 68.322, start_m: -31.012, end_m:   2.533, angle_deg: WING_ANG },
  { label: 'U',  axis: 'X', coord: 72.372, start_m: -32.657, end_m:   0.888, angle_deg: WING_ANG },
  { label: 'V',  axis: 'X', coord: 74.918, start_m: -33.692, end_m:  -0.147, angle_deg: WING_ANG },
  { label: 'W',  axis: 'X', coord: 79.272, start_m: -35.458, end_m:  -1.915, angle_deg: WING_ANG },
  { label: 'X',  axis: 'X', coord: 82.761, start_m: -36.874, end_m:  -3.332, angle_deg: WING_ANG },
  { label: 'Y',  axis: 'X', coord: 87.472, start_m: -38.785, end_m:  -5.245, angle_deg: WING_ANG },

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
  // axis='Y': angled 27.16°.
  // coord  = NS at EW = start_m  (= NS at the Grid M intersection).
  // start_m = EW at intersection with Grid M  (= 45.671 + orig_coord × 0.40625)
  // end_m   = EW at intersection with Grid Y  (= 87.472 + (orig_coord − 21.444) × 0.40625)
  // where orig_coord is the NS at EW=WING_EW_W=45.671 measured on A101.
  //
  //  Grid   orig_coord   new coord   start_m   end_m
  //  10     +14.819      +11.731     51.689    84.781
  //  11     +11.344      + 8.983     50.279    83.370
  //  12     + 6.594      + 5.220     48.349    81.441
  //  13     + 1.865      + 1.477     46.429    79.520
  //  14     − 2.335      − 1.849     44.722    77.815
  //  15     − 9.315      − 7.374     41.888    74.980
  //  16     −15.921      −12.604     39.205    72.297
  //  17     −18.280      −14.473     38.250    71.338
  //  18     −20.379      −16.133     37.395    70.488
  //  19     −27.552      −21.812     34.482    67.570
  { label: '10', axis: 'Y', coord:  11.731, start_m:  51.689, end_m:  84.781, angle_deg: WING_ANG },
  { label: '11', axis: 'Y', coord:   8.983, start_m:  50.279, end_m:  83.370, angle_deg: WING_ANG },
  { label: '12', axis: 'Y', coord:   5.220, start_m:  48.349, end_m:  81.441, angle_deg: WING_ANG },
  { label: '13', axis: 'Y', coord:   1.477, start_m:  46.429, end_m:  79.520, angle_deg: WING_ANG },
  { label: '14', axis: 'Y', coord:  -1.849, start_m:  44.722, end_m:  77.815, angle_deg: WING_ANG },
  { label: '15', axis: 'Y', coord:  -7.374, start_m:  41.888, end_m:  74.980, angle_deg: WING_ANG },
  { label: '16', axis: 'Y', coord: -12.604, start_m:  39.205, end_m:  72.297, angle_deg: WING_ANG },
  { label: '17', axis: 'Y', coord: -14.473, start_m:  38.250, end_m:  71.338, angle_deg: WING_ANG },
  { label: '18', axis: 'Y', coord: -16.133, start_m:  37.395, end_m:  70.488, angle_deg: WING_ANG },
  { label: '19', axis: 'Y', coord: -21.812, start_m:  34.482, end_m:  67.570, angle_deg: WING_ANG },
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
 * Three.js convention (post coordinate-flip): X = east (+right), Y = elevation (up),
 * Z = south (+south, i.e. north → −Z).
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
      // param = NS; EW = coord + NS * tanA; Three.js Z = −NS
      pt1 = [g.coord + g.start_m * tanA, floorY, -g.start_m];
      pt2 = [g.coord + g.end_m   * tanA, floorY, -g.end_m];
    } else {
      // param = EW; NS = coord − (EW − start_m) * tanA; Three.js Z = −NS
      pt1 = [g.start_m, floorY, -g.coord];
      pt2 = [g.end_m,   floorY, -(g.coord - (g.end_m - g.start_m) * tanA)];
    }
    map.set(g.label, { pt1, pt2 });
  }
  return map;
}

// ── Exported reference constants (used by CL lines and general reference) ──
export { WING_EW_W, WING_EW_E, WING_NS_S, WING_NS_N, WING_ANG, CL_ANG };
