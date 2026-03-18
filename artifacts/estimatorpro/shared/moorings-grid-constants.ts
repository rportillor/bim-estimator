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
 * CRITICAL GEOMETRIC ANCHOR (from drawing A101):
 *   Grid 9 × Grid 19 × CL all meet at one point: (EW=56.071, NS=0)
 *   orig_coord_19 = (56.071−45.671) × tan(27.16°) = 5.336 m
 *   All other 10–19 coords follow from the stored spacings.
 *
 * Wing boundary corners:
 *   M×10 = (EW=65.047, NS=+37.766)   NW corner
 *   Y×10 = (EW=98.138, NS=+20.789)   NE corner
 *   M×19 = (EW=47.838, NS= +4.224)   SW corner
 *   Y×19 = (EW=80.929, NS=−12.753)   SE corner
 *
 *   Grid 10 NS = +37.766 (M×10, wing northern boundary on Grid M)
 *   Grid 19 NS = + 4.224 (M×19, wing southern boundary on Grid M; crosses Grid 9 at CL)
 */

// GridlineDefinition type is also defined in grid-types.ts for generic use.
// This file keeps its own copy for the project-specific constants.
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
//
// CL_ANG is derived geometrically — same method used to establish CL coord:
//   Step 1: Grid 19 extended to NS=0  → EW = 45.671 + orig_19/tan(27.16°) = 56.071  ← CL at Grid 9
//   Step 2: Grid 10 extended to NS=40.830 → EW = 45.671 + (orig_10−40.830)/tan(27.16°) = 59.075  ← CL at Grid 1
//   Step 3: tan(CL_ANG) = (59.075−56.071)/40.830 = 0.073566  →  CL_ANG = arctan(0.073566) = 4.208°
//   Grid 2×11 and Grid 3×13 also land at EW≈59.075 — independent confirmation.
//   NOTE: 13.58° is a joint/construction angle on drawing A101, NOT the CL gridline slope.
//   DO NOT assume CL_ANG = WING_ANG/2. Always derive from wing anchor pairs for each project.
const CL_ANG    =  4.208;  // degrees — CLa / CL / CLb gridline slope (project-specific, derived above)

const WING_NS_S = -12.753; // Y×19 NS (southernmost wing point, SE corner)
const WING_NS_N =  37.766; // M×10 NS (northernmost point on Grid M, NW corner)
const WING_EW_W =  45.671; // Grid M EW at NS=0  (western wing reference)
const WING_EW_E =  87.472; // Grid Y EW at NS=0  (eastern wing reference)

// CL lines extend from the wing SE NS level up through the rectangular block north boundary
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
  // Grid 9 × Grid 19 × CL all meet at (EW=56.071, NS=0) — verified from A101.
  { label: 'CLa', axis: 'X', coord: 52.786, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CL',  axis: 'X', coord: 56.071, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },
  { label: 'CLb', axis: 'X', coord: 59.356, start_m: CL_NS_START, end_m: CL_NS_END, angle_deg: CL_ANG },

  // ── Wing EW-position lines (M–Y) ────────────────────────────────────────
  // axis='X': angled 27.16°; coord = EW at NS=0 (grid 9 level)
  // start_m = NS at intersection with Grid 19 (southern wing boundary)
  // end_m   = NS at intersection with Grid 10 (northern wing boundary)
  { label: 'M',  axis: 'X', coord: 45.671, start_m:   4.224, end_m:  37.766, angle_deg: WING_ANG },
  { label: 'N',  axis: 'X', coord: 49.054, start_m:   2.850, end_m:  36.392, angle_deg: WING_ANG },
  { label: 'P',  axis: 'X', coord: 50.956, start_m:   2.077, end_m:  35.620, angle_deg: WING_ANG },
  { label: 'Q',  axis: 'X', coord: 55.371, start_m:   0.284, end_m:  33.826, angle_deg: WING_ANG },
  { label: 'R',  axis: 'X', coord: 58.551, start_m:  -1.007, end_m:  32.535, angle_deg: WING_ANG },
  { label: 'S',  axis: 'X', coord: 65.272, start_m:  -3.737, end_m:  29.805, angle_deg: WING_ANG },
  { label: 'Sa', axis: 'X', coord: 66.021, start_m:  -4.041, end_m:  29.501, angle_deg: WING_ANG },
  { label: 'T',  axis: 'X', coord: 68.322, start_m:  -4.976, end_m:  28.566, angle_deg: WING_ANG },
  { label: 'U',  axis: 'X', coord: 72.372, start_m:  -6.621, end_m:  26.922, angle_deg: WING_ANG },
  { label: 'V',  axis: 'X', coord: 74.918, start_m:  -7.655, end_m:  25.888, angle_deg: WING_ANG },
  { label: 'W',  axis: 'X', coord: 79.272, start_m:  -9.423, end_m:  24.119, angle_deg: WING_ANG },
  { label: 'X',  axis: 'X', coord: 82.761, start_m: -10.840, end_m:  22.702, angle_deg: WING_ANG },
  { label: 'Y',  axis: 'X', coord: 87.472, start_m: -12.753, end_m:  20.789, angle_deg: WING_ANG },

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
  // coord  = NS at EW = start_m (= NS at the Grid M intersection).
  // start_m = EW at intersection with Grid M.
  // end_m   = EW at intersection with Grid Y.
  //
  // All orig_coords are POSITIVE (wing is NORTH of Grid 9, east of Grid L).
  // Anchor: Grid 19 crosses Grid 9 at CL (EW=56.071, NS=0) → orig_19=5.336
  //
  //  Grid  orig_coord   coord   start_m   end_m
  //  10    +47.707     +37.766  65.047    98.138
  //  11    +44.232     +35.015  63.635    96.726
  //  12    +39.482     +31.255  61.706    94.797
  //  13    +34.753     +27.511  59.786    92.876
  //  14    +30.553     +24.186  58.080    91.171
  //  15    +23.573     +18.661  55.245    88.336
  //  16    +16.967     +13.431  52.562    85.653
  //  17    +14.608     +11.564  51.604    84.695
  //  18    +12.509     + 9.902  50.751    83.842
  //  19    + 5.336     + 4.224  47.838    80.929
  { label: '10', axis: 'Y', coord:  37.766, start_m:  65.047, end_m:  98.138, angle_deg: WING_ANG },
  { label: '11', axis: 'Y', coord:  35.015, start_m:  63.635, end_m:  96.726, angle_deg: WING_ANG },
  { label: '12', axis: 'Y', coord:  31.255, start_m:  61.706, end_m:  94.797, angle_deg: WING_ANG },
  { label: '13', axis: 'Y', coord:  27.511, start_m:  59.786, end_m:  92.876, angle_deg: WING_ANG },
  { label: '14', axis: 'Y', coord:  24.186, start_m:  58.080, end_m:  91.171, angle_deg: WING_ANG },
  { label: '15', axis: 'Y', coord:  18.661, start_m:  55.245, end_m:  88.336, angle_deg: WING_ANG },
  { label: '16', axis: 'Y', coord:  13.431, start_m:  52.562, end_m:  85.653, angle_deg: WING_ANG },
  { label: '17', axis: 'Y', coord:  11.564, start_m:  51.604, end_m:  84.695, angle_deg: WING_ANG },
  { label: '18', axis: 'Y', coord:   9.902, start_m:  50.751, end_m:  83.842, angle_deg: WING_ANG },
  { label: '19', axis: 'Y', coord:   4.224, start_m:  47.838, end_m:  80.929, angle_deg: WING_ANG },
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
