// server/pipeline/coordinate-transform.ts
// Computes affine transforms that map sheet/drawing coordinates to model
// coordinates using grid intersections as control points.
// Uses least-squares fitting via the normal equations.

import type { GridData, GridAxis } from './stage-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ControlPoint {
  sheet: { x: number; y: number };  // position in drawing space
  model: { x: number; y: number };  // position in model space (from confirmed grid)
}

export interface AffineTransform {
  // 2D affine: [a, b, tx; c, d, ty; 0, 0, 1]
  a: number; b: number; tx: number;
  c: number; d: number; ty: number;
  scale: number;        // uniform scale factor
  rotation_deg: number; // rotation in degrees
  residual: number;     // RMS error of fit
  controlPoints: ControlPoint[];
}

// ---------------------------------------------------------------------------
// Helpers: 3x3 matrix operations for normal equations
// ---------------------------------------------------------------------------

/** Invert a 3x3 symmetric matrix. Returns null if singular. */
function invert3x3(m: number[][]): number[][] | null {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = m;

  const det =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;

  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

/** Multiply 3x3 matrix by 3x1 vector. */
function mulMat3Vec3(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Check if a set of 2D points are collinear (within tolerance). */
function areCollinear(pts: Array<{ x: number; y: number }>, eps = 1e-6): boolean {
  if (pts.length < 3) return true;
  const [p0, p1] = pts;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < eps) return true; // first two points coincide

  // Normal to the line through p0-p1
  const nx = -dy / len;
  const ny = dx / len;

  for (let i = 2; i < pts.length; i++) {
    const dist = Math.abs((pts[i].x - p0.x) * nx + (pts[i].y - p0.y) * ny);
    if (dist > eps) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Core: compute best-fit affine transform via least squares
// ---------------------------------------------------------------------------

/**
 * Compute best-fit affine transform from control point pairs.
 * Requires at least 3 non-collinear points.
 * Solves the normal equations: (A^T A)^-1 A^T b
 * where A = [x_sheet, y_sheet, 1] for each point,
 * and b = x_model (then y_model in a second solve).
 */
export function computeAffineTransform(points: ControlPoint[]): AffineTransform | null {
  if (points.length < 3) return null;

  // Check for collinearity in sheet coordinates
  if (areCollinear(points.map(p => p.sheet))) return null;

  const n = points.length;

  // Build A^T A (3x3 symmetric) and A^T bx, A^T by (3x1 each)
  let sumXX = 0, sumXY = 0, sumX = 0;
  let sumYY = 0, sumY = 0;
  let sumN = n;
  let sumXbx = 0, sumYbx = 0, sumBx = 0;
  let sumXby = 0, sumYby = 0, sumBy = 0;

  for (const pt of points) {
    const sx = pt.sheet.x;
    const sy = pt.sheet.y;
    const mx = pt.model.x;
    const my = pt.model.y;

    sumXX += sx * sx;
    sumXY += sx * sy;
    sumX  += sx;
    sumYY += sy * sy;
    sumY  += sy;

    sumXbx += sx * mx;
    sumYbx += sy * mx;
    sumBx  += mx;

    sumXby += sx * my;
    sumYby += sy * my;
    sumBy  += my;
  }

  // A^T A
  const ATA: number[][] = [
    [sumXX, sumXY, sumX],
    [sumXY, sumYY, sumY],
    [sumX,  sumY,  sumN],
  ];

  const ATAinv = invert3x3(ATA);
  if (!ATAinv) return null;

  // Solve for [a, b, tx]
  const ATbx = [sumXbx, sumYbx, sumBx];
  const solX = mulMat3Vec3(ATAinv, ATbx);

  // Solve for [c, d, ty]
  const ATby = [sumXby, sumYby, sumBy];
  const solY = mulMat3Vec3(ATAinv, ATby);

  const a = solX[0], b = solX[1], tx = solX[2];
  const c = solY[0], d = solY[1], ty = solY[2];

  // Compute scale and rotation
  const scale = Math.sqrt(a * a + c * c);
  const rotation_rad = Math.atan2(c, a);
  const rotation_deg = (rotation_rad * 180) / Math.PI;

  // Compute residual: RMS of (transformed_sheet - model)
  let sumSqDist = 0;
  for (const pt of points) {
    const txf = a * pt.sheet.x + b * pt.sheet.y + tx;
    const tyf = c * pt.sheet.x + d * pt.sheet.y + ty;
    const dx = txf - pt.model.x;
    const dy = tyf - pt.model.y;
    sumSqDist += dx * dx + dy * dy;
  }
  const residual = Math.sqrt(sumSqDist / n);

  return {
    a, b, tx,
    c, d, ty,
    scale,
    rotation_deg,
    residual,
    controlPoints: points,
  };
}

// ---------------------------------------------------------------------------
// Transform application
// ---------------------------------------------------------------------------

/**
 * Apply an affine transform to a 2D point.
 */
export function transformPoint(
  transform: AffineTransform,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: transform.a * point.x + transform.b * point.y + transform.tx,
    y: transform.c * point.x + transform.d * point.y + transform.ty,
  };
}

// ---------------------------------------------------------------------------
// Control point construction from grid data
// ---------------------------------------------------------------------------

/**
 * Build control points from a confirmed grid (model coordinates) and
 * Claude's extracted grid (sheet coordinates) by matching grid labels.
 *
 * For each grid intersection where both grids have matching labels,
 * we create a control point pair.
 */
export function buildControlPointsFromGrid(
  confirmedGrid: GridData,
  extractedGrid: GridData,
): ControlPoint[] {
  const controlPoints: ControlPoint[] = [];

  // Build lookup maps: label -> position for extracted (sheet) grid
  const extractedAlpha = new Map<string, GridAxis>();
  for (const g of extractedGrid.alphaGridlines) {
    extractedAlpha.set(g.label.toUpperCase().trim(), g);
  }
  const extractedNumeric = new Map<string, GridAxis>();
  for (const g of extractedGrid.numericGridlines) {
    extractedNumeric.set(g.label.toUpperCase().trim(), g);
  }

  // For each confirmed alpha-numeric intersection that also appears in extracted grid,
  // create a control point pair
  for (const cAlpha of confirmedGrid.alphaGridlines) {
    const eAlpha = extractedAlpha.get(cAlpha.label.toUpperCase().trim());
    if (!eAlpha) continue;

    for (const cNumeric of confirmedGrid.numericGridlines) {
      const eNumeric = extractedNumeric.get(cNumeric.label.toUpperCase().trim());
      if (!eNumeric) continue;

      // Model coordinates from confirmed grid: alpha gives X, numeric gives Y
      // (with angle adjustment if applicable)
      const modelX = cAlpha.position_m;
      const modelY = cNumeric.position_m;

      // Sheet coordinates from extracted (raw) grid
      const sheetX = eAlpha.position_m;
      const sheetY = eNumeric.position_m;

      // If the gridline has an angle, the intersection moves.
      // For angled gridlines, project along the angle to find the intersection.
      // For orthogonal gridlines (angle_deg === 0), the intersection is at (alphaPos, numericPos).
      if (Math.abs(cAlpha.angle_deg) < 0.01 && Math.abs(cNumeric.angle_deg) < 0.01) {
        controlPoints.push({
          sheet: { x: sheetX, y: sheetY },
          model: { x: modelX, y: modelY },
        });
      } else {
        // For angled gridlines, compute the actual intersection in model space.
        // Alpha gridline runs at angle from its position along the numeric axis.
        // Numeric gridline runs at its angle from its position along the alpha axis.
        const alphaAngleRad = (cAlpha.angle_deg * Math.PI) / 180;
        const numericAngleRad = (cNumeric.angle_deg * Math.PI) / 180;

        // Alpha line direction: (cos(90+angle), sin(90+angle)) = (-sin(angle), cos(angle))
        // passes through (alphaPos, 0)
        // Numeric line direction: (cos(angle), sin(angle))
        // passes through (0, numericPos)
        const dax = -Math.sin(alphaAngleRad);
        const day = Math.cos(alphaAngleRad);
        const dnx = Math.cos(numericAngleRad);
        const dny = Math.sin(numericAngleRad);

        // Solve: P_alpha + t * d_alpha = P_numeric + s * d_numeric
        // (modelX, 0) + t * (dax, day) = (0, modelY) + s * (dnx, dny)
        const denom = dax * dny - day * dnx;
        if (Math.abs(denom) > 1e-10) {
          const t = ((0 - modelX) * dny - (modelY - 0) * dnx) / denom;
          const ix = modelX + t * dax;
          const iy = 0 + t * day;

          // Same logic for extracted grid (sheet space)
          const eAlphaAngleRad = (eAlpha.angle_deg * Math.PI) / 180;
          const eNumericAngleRad = (eNumeric.angle_deg * Math.PI) / 180;
          const edax = -Math.sin(eAlphaAngleRad);
          const eday = Math.cos(eAlphaAngleRad);
          const ednx = Math.cos(eNumericAngleRad);
          const edny = Math.sin(eNumericAngleRad);
          const eDenom = edax * edny - eday * ednx;
          if (Math.abs(eDenom) > 1e-10) {
            const et = ((0 - sheetX) * edny - (sheetY - 0) * ednx) / eDenom;
            const six = sheetX + et * edax;
            const siy = 0 + et * eday;

            controlPoints.push({
              sheet: { x: six, y: siy },
              model: { x: ix, y: iy },
            });
          }
        }
      }
    }
  }

  return controlPoints;
}

// ---------------------------------------------------------------------------
// Convenience: compute and return transform from two grids
// ---------------------------------------------------------------------------

/**
 * Build control points from confirmed vs extracted grids, then compute
 * the best-fit affine transform. Returns null if insufficient points.
 */
export function computeAndStoreTransform(
  confirmedGrid: GridData,
  extractedGrid: GridData,
): AffineTransform | null {
  const controlPoints = buildControlPointsFromGrid(confirmedGrid, extractedGrid);
  if (controlPoints.length < 3) return null;
  return computeAffineTransform(controlPoints);
}
