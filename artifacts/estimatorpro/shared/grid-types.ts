/**
 * Generic gridline type definitions — project-agnostic.
 * Used by the PDF parser, parameter resolver, mesh builder, and viewer.
 */

export interface GridlineDefinition {
  label: string;
  axis: 'X' | 'Y';
  coord: number;      // position in metres along the primary axis at the reference NS/EW line
  start_m: number;    // extent start in metres along the perpendicular axis
  end_m: number;      // extent end in metres along the perpendicular axis
  angle_deg: number;  // rotation in degrees (0 = orthogonal, non-zero = angled wing)
}

/**
 * Compute the intersection point of two gridlines (one alpha axis='X', one numeric axis='Y').
 * Returns the real-world (EW, NS) coordinates where the two lines cross.
 *
 * Works for any combination: straight+straight, straight+angled, angled+angled.
 *
 * Alpha gridline (axis='X'): EW = coord + NS * tan(angle)
 * Numeric gridline (axis='Y'): NS = coord - (EW - start_m) * tan(angle)
 */
export function computeGridIntersection(
  alphaLabel: string,
  numericLabel: string,
  gridlines: GridlineDefinition[],
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
  if (Math.abs(denom) < 1e-10) return null; // Parallel lines

  const ns = (numeric.coord + (numeric.start_m - alpha.coord) * tanNumeric) / denom;
  const ew = alpha.coord + ns * tanAlpha;

  return { ew, ns };
}

/**
 * Look up a gridline definition by label.
 */
export function getGridline(label: string, gridlines: GridlineDefinition[]): GridlineDefinition | undefined {
  return gridlines.find(
    g => g.label.toUpperCase() === label.toUpperCase()
  );
}

/**
 * Compute 3D endpoints for all gridlines at a given floor elevation.
 * Three.js convention: X = EW, Y = elevation, Z = NS.
 */
export function computeGridEndpoints(
  gridlines: GridlineDefinition[],
  floorY: number,
): Map<string, { pt1: [number, number, number]; pt2: [number, number, number] }> {
  const map = new Map<string, { pt1: [number, number, number]; pt2: [number, number, number] }>();
  for (const g of gridlines) {
    const tanA = Math.tan(g.angle_deg * (Math.PI / 180));
    let pt1: [number, number, number];
    let pt2: [number, number, number];
    if (g.axis === 'X') {
      pt1 = [g.coord + g.start_m * tanA, floorY, g.start_m];
      pt2 = [g.coord + g.end_m * tanA, floorY, g.end_m];
    } else {
      pt1 = [g.start_m, floorY, g.coord];
      pt2 = [g.end_m, floorY, g.coord - (g.end_m - g.start_m) * tanA];
    }
    map.set(g.label, { pt1, pt2 });
  }
  return map;
}
