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
 * Wing angle  : 27.16° (two turns from bearing 166.42°)
 * CL_ANG     : 13.58° = WING_ANG / 2  (construction joint angle annotated on A101)
 *
 * Key anchor dimensions (all metres, measured from PDF A101):
 *   Grid 9  NS = 0         (south NS reference, origin)
 *   Grid 1  NS = 40.830    (north NS reference, rectangular block)
 *   Grid A  EW = 0         (west EW reference)
 *   Grid L  EW = 41.999    (east EW reference, rectangular block)
 *   Grid M  EW = 45.671    (at NS=0, wing western reference line)
 *   Grid Y  EW = 87.472    (at NS=0, wing eastern reference line)
 *
 * CRITICAL GEOMETRIC CONSTRAINT (from drawing A101):
 *   Every rect×wing pair (Grid n × Grid w) intersects EXACTLY on the CL line.
 *   CL at NS = n  →  EW_cl = CL_COORD + n × tan(CL_ANG) = 43.810 + n × 0.24156
 *
 *   Wing line w's orig_coord (NS at EW=45.671 along the line) is therefore:
 *     orig_w = n × (1 + tanW × tanCL) + (CL_COORD − WING_EW_W) × tanW
 *            = n × 1.12393 + (43.810 − 45.671) × 0.51305
 *            = n × 1.12393 − 0.955
 *
 *   WING ANCHOR: Grid 9 × Grid 19 on CL at NS=0 → EW = CL_COORD = 43.810
 *     orig_19 = 0 × 1.12393 − 0.955 = −0.955 m  (south of Grid 9)
 *
 * CL zone EW positions at NS=0 (Grid 9) — derived directly from drawing A101 dimensions:
 *   "1959" mm = CLb to Grid N  → CLb = N(49.054) − 1.959 = 47.095 m
 *   "3285" mm = equal spacing CLa↔CL↔CLb
 *     CLb = 47.095 m, CL = 43.810 m, CLa = 40.525 m
 *
 * Wing boundary corners (intersections of outer grid lines):
 *   M×10 = (EW=63.921, NS=+35.572)   NW corner of wing
 *   Y×10 = (EW=97.012, NS=+18.595)   NE corner of wing
 *   M×19 = (EW=45.283, NS= −0.756)   SW corner of wing
 *   Y×19 = (EW=78.374, NS=−17.733)   SE corner of wing
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
const CL_ANG    = WING_ANG / 2;  // 13.58° — CLa / CL / CLb gridline slope (annotated on A101)

// CL zone EW positions at NS=0 (Grid 9) — derived directly from drawing A101 dimensions:
//   "3285" mm = equal CL spacing, "1959" mm = CLb to Grid N
const CL_SPACING = 3.285;   // metres — equal spacing between each pair of CL zone lines
const CL_COORD   = 43.810;  // CL at NS=0 (m); CLb=N−1959mm, CL=CLb−3285mm

// Reference EW coords for the wing (at NS=0 / Grid 9 level)
const WING_EW_W =  45.671; // Grid M EW at NS=0
const WING_EW_E =  87.472; // Grid Y EW at NS=0

// Wing NS extents (derived from corner intersections):
//   WING_NS_N = NS of M×10 (Grid M × Grid 10) = 35.572 m north of Grid 9
//   WING_NS_S = NS of Y×19 (Grid Y × Grid 19) = 17.733 m south of Grid 9
const WING_NS_N =  35.572; // M×10 NS (northern wing boundary on Grid M)
const WING_NS_S = -17.733; // Y×19 NS (southern wing boundary on Grid Y)

// CL lines span exactly the rectangular block: Grid 9 (NS=0) → Grid 1 (NS=40.830).
const CL_NS_START = RECT_NS_START;
const CL_NS_END   = RECT_NS_END;

// ── How wing-line extents are computed ────────────────────────────────────────
//
// CONSTRAINT: rect×wing pair n×w intersects on CL.  CL at NS=n: EW = 43.810 + n×tan(13.58°)
// tanW = tan(27.16°) = 0.51305,  tanCL = tan(13.58°) = 0.24156,  denom = 1+tanW² = 1.26322
//
// orig_coord_w (NS at EW=45.671 along wing line w):
//   orig_w = n_rect × (1 + tanW×tanCL) + (CL_COORD − WING_EW_W) × tanW
//          = n_rect × 1.12393 − 0.955
//
// All 10–19 orig_coord values (all anchored to CL crossings):
//   Grid 19: −0.955  Grid 18: +5.660  Grid 17: +8.311  Grid 16: +15.736
//   Grid 15: +23.581 Grid 14: +28.301 Grid 13: +30.376 Grid 12: +35.691 (interp.)
//   Grid 11: +41.030 Grid 10: +44.935
//
// Wing axis='Y' lines (10–19):
//   coord_i   = orig_i / denom
//   start_m_i = WING_EW_W + coord_i × tanW     (EW at Grid M intersection)
//   end_m_i   = WING_EW_E + (orig_i − (WING_EW_E−WING_EW_W)×tanW) × tanW / denom
//             = WING_EW_E + (orig_i − 21.451) × tanW / denom
//
// Wing axis='X' lines (M–Y):
//   start_m_j = (coord_19 + (start_m_19 − c_j) × tanW) / denom   (NS at Grid_j × Grid_19)
//   end_m_j   = (coord_10 + (start_m_10 − c_j) × tanW) / denom   (NS at Grid_j × Grid_10)
//   where new Grid_19: coord=−0.756, start_m=45.283
//         new Grid_10: coord=+35.572, start_m=63.921
// ──────────────────────────────────────────────────────────────────────────────

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
  // axis='X': angled CL_ANG=13.58°; bridge the rectangular block and the wing.
  // At NS=0 (Grid 9): CLa=40.525, CL=43.810, CLb=47.095.
  // All rect×wing pairs intersect on the CL line (EW = 43.810 + NS×tan13.58°).
  { label: 'CLa', axis: 'X', coord: CL_COORD - CL_SPACING, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CL',  axis: 'X', coord: CL_COORD,               start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CLb', axis: 'X', coord: CL_COORD + CL_SPACING,  start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },

  // ── Wing EW-position lines (M–Y) ────────────────────────────────────────
  // axis='X': angled 27.16°; coord = EW at NS=0.
  // start_m = NS at intersection with Grid 19 (southern wing boundary).
  // end_m   = NS at intersection with Grid 10 (northern wing boundary).
  // Both derived from new Grid_19 (coord=−0.756, start_m=45.283)
  //                 and new Grid_10 (coord=+35.572, start_m=63.921).
  { label: 'M',  axis: 'X', coord: 45.671, start_m:  -0.756, end_m:  35.572, angle_deg: WING_ANG },
  { label: 'N',  axis: 'X', coord: 49.054, start_m:  -2.130, end_m:  34.198, angle_deg: WING_ANG },
  { label: 'P',  axis: 'X', coord: 50.956, start_m:  -2.903, end_m:  33.425, angle_deg: WING_ANG },
  { label: 'Q',  axis: 'X', coord: 55.371, start_m:  -4.696, end_m:  31.632, angle_deg: WING_ANG },
  { label: 'R',  axis: 'X', coord: 58.551, start_m:  -5.987, end_m:  30.341, angle_deg: WING_ANG },
  { label: 'S',  axis: 'X', coord: 65.272, start_m:  -8.717, end_m:  27.611, angle_deg: WING_ANG },
  { label: 'Sa', axis: 'X', coord: 66.021, start_m:  -9.021, end_m:  27.307, angle_deg: WING_ANG },
  { label: 'T',  axis: 'X', coord: 68.322, start_m:  -9.956, end_m:  26.372, angle_deg: WING_ANG },
  { label: 'U',  axis: 'X', coord: 72.372, start_m: -11.600, end_m:  24.728, angle_deg: WING_ANG },
  { label: 'V',  axis: 'X', coord: 74.918, start_m: -12.635, end_m:  23.693, angle_deg: WING_ANG },
  { label: 'W',  axis: 'X', coord: 79.272, start_m: -14.403, end_m:  21.925, angle_deg: WING_ANG },
  { label: 'X',  axis: 'X', coord: 82.761, start_m: -15.820, end_m:  20.508, angle_deg: WING_ANG },
  { label: 'Y',  axis: 'X', coord: 87.472, start_m: -17.733, end_m:  18.595, angle_deg: WING_ANG },

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
  // start_m = EW at intersection with Grid M.
  // end_m   = EW at intersection with Grid Y.
  //
  // Anchor constraint: orig_w = n_rect × 1.12393 − 0.955
  //   coord = orig / 1.26322,  start_m = 45.671 + coord × 0.51305
  //
  //  Grid  orig_coord   coord   start_m   end_m      paired rect NS
  //  10    +44.935     +35.572  63.921    97.012      Grid 1  (NS=40.830)
  //  11    +41.030     +32.480  62.335    95.426      Grid 2  (NS=37.355)
  //  12    +35.691     +28.254  60.167    93.258      (interpolated — no rect pair)
  //  13    +30.376     +24.046  58.008    91.099      Grid 3  (NS=27.876)
  //  14    +28.301     +22.404  57.165    90.256      Grid 4  (NS=26.030)
  //  15    +23.581     +18.667  55.248    88.339      Grid 5  (NS=21.830)
  //  16    +15.736     +12.457  52.062    85.153      Grid 6  (NS=14.850)
  //  17    + 8.311     + 6.579  49.046    82.137      Grid 7  (NS= 8.244)
  //  18    + 5.660     + 4.480  47.970    81.060      Grid 8  (NS= 5.885)
  //  19    − 0.955     − 0.756  45.283    78.374      Grid 9  (NS= 0.000)
  { label: '10', axis: 'Y', coord:  35.572, start_m:  63.921, end_m:  97.012, angle_deg: WING_ANG },
  { label: '11', axis: 'Y', coord:  32.480, start_m:  62.335, end_m:  95.426, angle_deg: WING_ANG },
  { label: '12', axis: 'Y', coord:  28.254, start_m:  60.167, end_m:  93.258, angle_deg: WING_ANG },
  { label: '13', axis: 'Y', coord:  24.046, start_m:  58.008, end_m:  91.099, angle_deg: WING_ANG },
  { label: '14', axis: 'Y', coord:  22.404, start_m:  57.165, end_m:  90.256, angle_deg: WING_ANG },
  { label: '15', axis: 'Y', coord:  18.667, start_m:  55.248, end_m:  88.339, angle_deg: WING_ANG },
  { label: '16', axis: 'Y', coord:  12.457, start_m:  52.062, end_m:  85.153, angle_deg: WING_ANG },
  { label: '17', axis: 'Y', coord:   6.579, start_m:  49.046, end_m:  82.137, angle_deg: WING_ANG },
  { label: '18', axis: 'Y', coord:   4.480, start_m:  47.970, end_m:  81.060, angle_deg: WING_ANG },
  { label: '19', axis: 'Y', coord:  -0.756, start_m:  45.283, end_m:  78.374, angle_deg: WING_ANG },
];

/**
 * Compute the intersection point of two gridlines (one alpha, one numeric).
 * Returns the real-world (EW, NS) coordinates where the two lines cross.
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

  // Alpha line:   EW = alpha.coord + NS * tanAlpha
  // Numeric line: NS = numeric.coord - (EW - numeric.start_m) * tanNumeric
  // Solving: NS = (numeric.coord + (numeric.start_m - alpha.coord) * tanNumeric) / (1 + tanAlpha * tanNumeric)

  const denom = 1 + tanAlpha * tanNumeric;
  if (Math.abs(denom) < 1e-10) return null;

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
