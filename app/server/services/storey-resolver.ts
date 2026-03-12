/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STOREY & GRID RESOLVER — Floor Structure Validation
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Resolves, validates, and enriches storey/grid data extracted by Claude AI
 *  from construction documents (floor plans, sections, elevations).
 *
 *  Validation includes:
 *    • Floor-to-floor height bounds (NBC / OBC residential: 2.4m–6.0m)
 *    • Basement/below-grade detection
 *    • Naming convention normalization
 *    • Duplicate and gap detection
 *    • Grid spacing consistency checks
 *    • Cross-reference between storeys and grids
 *
 *  Standards: NBC 2020 9.5.3 (min ceiling heights), OBC 9.5.3,
 *             CIQS Standard Method (elemental measurement by floor)
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type Storey = {
  name: string;
  elevation_m: number;
  floorToFloorHeight_m?: number;    // Calculated: distance to next storey
  isBelowGrade?: boolean;
  occupancy?: string;               // e.g., 'residential', 'parking', 'mechanical'
};

export type Grid = {
  name: string;
  x: number;
  y: number;
  orientation: 'X' | 'Y';
  spacing_m?: number;
};

export interface StoreyValidation {
  valid: boolean;
  storeys: Storey[];
  warnings: string[];
  corrections: string[];
}

export interface GridValidation {
  valid: boolean;
  grids: Grid[];
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS — Canadian Building Code floor height limits
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimum floor-to-floor height (NBC 9.5.3.1 — min 2.4m clear + structure) */
const MIN_FLOOR_HEIGHT_M = 2.4;

/** Maximum reasonable floor-to-floor for residential/commercial */
const MAX_FLOOR_HEIGHT_M = 6.0;

/** Maximum reasonable floor-to-floor for parking/mechanical */
const MAX_FLOOR_HEIGHT_PARKING_M = 4.5;

/** Typical residential floor-to-floor (for gap-filling heuristic) */
const TYPICAL_RESIDENTIAL_HEIGHT_M = 3.0;

/** Maximum reasonable number of storeys for this project type */
const MAX_STOREYS = 60;

/** Below-grade threshold: if elevation < this, treat as below grade */
const BELOW_GRADE_THRESHOLD_M = -0.3;

/** Grid spacing bounds (m) */
const MIN_GRID_SPACING_M = 1.0;
const MAX_GRID_SPACING_M = 20.0;

// ═══════════════════════════════════════════════════════════════════════════════
//  STOREY RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve storeys from AI extraction with full validation.
 *
 * Steps:
 *  1. Parse and deduplicate AI-provided storey data
 *  2. Normalize naming conventions
 *  3. Ensure a base level (Level 1 at 0.0m) exists
 *  4. Calculate floor-to-floor heights
 *  5. Validate heights against NBC/OBC bounds
 *  6. Detect below-grade levels
 *  7. Flag anomalies
 */
export function resolveStoreysValidated(raw: any): StoreyValidation {
  const warnings: string[] = [];
  const corrections: string[] = [];

  // 1. Parse from AI output
  const fromAI: any[] = Array.isArray(raw?.storeys) ? raw.storeys : [];

  if (fromAI.length === 0) {
    warnings.push('No storeys provided by AI extraction — using single base level');
  }

  // 2. Deduplicate by name, normalize
  const uniq = new Map<string, Storey>();
  for (const s of fromAI) {
    if (!s?.name) continue;
    const normalized = normalizeStoreyName(s.name);
    const elevation = Number(s.elevation_m);

    if (isNaN(elevation)) {
      warnings.push(`Storey "${s.name}": invalid elevation "${s.elevation_m}" — skipped`);
      continue;
    }

    if (uniq.has(normalized)) {
      const existing = uniq.get(normalized)!;
      if (Math.abs(existing.elevation_m - elevation) > 0.01) {
        warnings.push(
          `Duplicate storey "${normalized}" with conflicting elevations: ` +
          `${existing.elevation_m}m vs ${elevation}m — keeping first`
        );
      }
      continue;
    }

    uniq.set(normalized, {
      name: normalized,
      elevation_m: elevation,
      isBelowGrade: elevation < BELOW_GRADE_THRESHOLD_M,
      occupancy: s.occupancy || inferOccupancy(normalized, elevation),
    });
  }

  // 3. Ensure base level exists
  const hasBase = Array.from(uniq.values()).some(s => Math.abs(s.elevation_m) < 0.01);
  if (!hasBase) {
    uniq.set('Level 1', {
      name: 'Level 1',
      elevation_m: 0,
      isBelowGrade: false,
      occupancy: 'residential',
    });
    corrections.push('Added base "Level 1" at elevation 0.0m (not provided by extraction)');
  }

  // 4. Sanity check count
  if (uniq.size > MAX_STOREYS) {
    warnings.push(`${uniq.size} storeys detected — exceeds maximum ${MAX_STOREYS}. Verify extraction.`);
  }

  // 5. Sort by elevation, calculate floor-to-floor heights
  const sorted = Array.from(uniq.values()).sort((a, b) => a.elevation_m - b.elevation_m);

  for (let i = 0; i < sorted.length - 1; i++) {
    const ftf = sorted[i + 1].elevation_m - sorted[i].elevation_m;
    sorted[i].floorToFloorHeight_m = Math.round(ftf * 1000) / 1000;
  }

  // 6. Validate floor-to-floor heights
  for (const storey of sorted) {
    if (storey.floorToFloorHeight_m === undefined) continue; // top floor

    const ftf = storey.floorToFloorHeight_m;
    const maxH = isParking(storey) ? MAX_FLOOR_HEIGHT_PARKING_M : MAX_FLOOR_HEIGHT_M;

    if (ftf < MIN_FLOOR_HEIGHT_M) {
      warnings.push(
        `"${storey.name}": floor-to-floor height ${ftf}m is below NBC minimum ${MIN_FLOOR_HEIGHT_M}m — ` +
        `verify section drawing or issue RFI`
      );
    }

    if (ftf > maxH) {
      warnings.push(
        `"${storey.name}": floor-to-floor height ${ftf}m exceeds typical maximum ${maxH}m — ` +
        `verify this is not a data extraction error`
      );
    }

    // Check for near-zero heights (likely duplicate elevation)
    if (ftf < 0.5) {
      warnings.push(
        `"${storey.name}" and "${sorted[sorted.indexOf(storey) + 1]?.name}": ` +
        `only ${ftf}m apart — likely duplicate or mezzanine`
      );
    }
  }

  // 7. Check for large elevation gaps (missing floors)
  for (let i = 0; i < sorted.length - 1; i++) {
    const ftf = sorted[i].floorToFloorHeight_m!;
    if (ftf > MAX_FLOOR_HEIGHT_M * 1.5) {
      const possibleMissing = Math.round(ftf / TYPICAL_RESIDENTIAL_HEIGHT_M) - 1;
      if (possibleMissing > 0) {
        warnings.push(
          `Large gap between "${sorted[i].name}" (${sorted[i].elevation_m}m) and ` +
          `"${sorted[i + 1].name}" (${sorted[i + 1].elevation_m}m): ${ftf}m — ` +
          `possibly ${possibleMissing} missing floor(s). Verify against section drawings.`
        );
      }
    }
  }

  return {
    valid: warnings.length === 0,
    storeys: sorted,
    warnings,
    corrections,
  };
}

/**
 * Backward-compatible storey resolver — returns Storey[] directly.
 * This is the default export used by bim-generator.ts.
 * For full validation results, use resolveStoreysValidated().
 */
export function resolveStoreys(raw: any): Storey[] {
  return resolveStoreysValidated(raw).storeys;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve grids from AI extraction with validation.
 */
export function resolveGridsValidated(raw: any): GridValidation {
  const fromAI: any[] = Array.isArray(raw?.grids) ? raw.grids : [];
  const warnings: string[] = [];

  if (fromAI.length === 0) {
    warnings.push('No grids provided by AI extraction');
    return { valid: true, grids: [], warnings };
  }

  // Parse and validate
  const grids: Grid[] = [];
  const seen = new Set<string>();

  for (const g of fromAI) {
    const name = String(g.name || '').trim();
    if (!name) continue;

    if (seen.has(name)) {
      warnings.push(`Duplicate grid "${name}" — skipping`);
      continue;
    }
    seen.add(name);

    const x = Number(g.x) || 0;
    const y = Number(g.y) || 0;
    const orientation: 'X' | 'Y' = g.orientation === 'Y' ? 'Y' : 'X';
    const spacing = g.spacing_m ? Number(g.spacing_m) : undefined;

    // Validate spacing
    if (spacing !== undefined) {
      if (spacing < MIN_GRID_SPACING_M) {
        warnings.push(`Grid "${name}": spacing ${spacing}m below minimum ${MIN_GRID_SPACING_M}m`);
      }
      if (spacing > MAX_GRID_SPACING_M) {
        warnings.push(`Grid "${name}": spacing ${spacing}m above maximum ${MAX_GRID_SPACING_M}m`);
      }
    }

    grids.push({ name, x, y, orientation, spacing_m: spacing });
  }

  // Check grid consistency — X grids should share similar Y, Y grids similar X
  const xGrids = grids.filter(g => g.orientation === 'X');
  const yGrids = grids.filter(g => g.orientation === 'Y');

  if (xGrids.length > 1) {
    const spacings = calculateSpacings(xGrids, 'y');
    validateGridSpacings(spacings, 'X', warnings);
  }

  if (yGrids.length > 1) {
    const spacings = calculateSpacings(yGrids, 'x');
    validateGridSpacings(spacings, 'Y', warnings);
  }

  return {
    valid: warnings.length === 0,
    grids,
    warnings,
  };
}

/**
 * Backward-compatible grid resolver — returns Grid[] directly.
 * For full validation results, use resolveGridsValidated().
 */
export function resolveGrids(raw: any): Grid[] {
  return resolveGridsValidated(raw).grids;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CROSS-REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Cross-reference storeys and grids to detect structural consistency issues.
 * Returns warnings if grids exist but no storeys, or vice versa.
 */
export function crossReferenceStoreysAndGrids(
  storeyResult: StoreyValidation,
  gridResult: GridValidation
): string[] {
  const warnings: string[] = [];

  if (storeyResult.storeys.length > 0 && gridResult.grids.length === 0) {
    warnings.push(
      'Storeys defined but no structural grids — verify grid extraction from structural drawings'
    );
  }

  if (gridResult.grids.length > 0 && storeyResult.storeys.length <= 1) {
    warnings.push(
      'Structural grids defined but only 1 storey — verify floor extraction from section drawings'
    );
  }

  // Check that the building footprint implied by grids is reasonable
  if (gridResult.grids.length >= 2) {
    const xGrids = gridResult.grids.filter(g => g.orientation === 'X');
    const yGrids = gridResult.grids.filter(g => g.orientation === 'Y');

    if (xGrids.length >= 2 && yGrids.length >= 2) {
      const xSpan = Math.abs(xGrids[xGrids.length - 1].y - xGrids[0].y);
      const ySpan = Math.abs(yGrids[yGrids.length - 1].x - yGrids[0].x);

      if (xSpan > 0 && ySpan > 0) {
        const footprintM2 = xSpan * ySpan;
        const totalFloorArea = footprintM2 * storeyResult.storeys.length;

        if (footprintM2 < 10) {
          warnings.push(`Grid footprint ${xSpan.toFixed(1)}m × ${ySpan.toFixed(1)}m = ${footprintM2.toFixed(0)}m² — unusually small`);
        }
        if (footprintM2 > 50000) {
          warnings.push(`Grid footprint ${xSpan.toFixed(1)}m × ${ySpan.toFixed(1)}m = ${footprintM2.toFixed(0)}m² — verify scale`);
        }

        // Log total GFA for reference
        if (totalFloorArea > 0) {
          // This is informational, not a warning
        }
      }
    }
  }

  return warnings;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize storey names to a consistent convention.
 * Handles common variations: "1st Floor" → "Level 1", "B1" → "Basement 1", etc.
 */
function normalizeStoreyName(name: string): string {
  const trimmed = name.trim();
  const upper = trimmed.toUpperCase();

  // Basement patterns
  if (/^B\d+$/i.test(trimmed)) return `Basement ${trimmed.substring(1)}`;
  if (/^BASEMENT\s*\d*$/i.test(trimmed)) {
    const num = trimmed.match(/\d+/)?.[0] || '1';
    return `Basement ${num}`;
  }

  // Parking patterns
  if (/^P\d+$/i.test(trimmed)) return `Parking ${trimmed.substring(1)}`;

  // Ground/Main floor
  if (upper === 'GROUND' || upper === 'GROUND FLOOR' || upper === 'GF') return 'Level 1';
  if (upper === 'MAIN' || upper === 'MAIN FLOOR') return 'Level 1';

  // Roof
  if (upper === 'ROOF' || upper === 'ROOF LEVEL') return 'Roof';

  // Mezzanine
  if (/^MEZZ/i.test(trimmed)) return 'Mezzanine';

  // Ordinal patterns: "1st Floor", "2nd Floor"
  const ordinalMatch = trimmed.match(/^(\d+)(?:st|nd|rd|th)\s+(?:floor|level|storey)/i);
  if (ordinalMatch) return `Level ${ordinalMatch[1]}`;

  // "Floor 1", "Level 1" patterns — normalize to "Level N"
  const levelMatch = trimmed.match(/^(?:floor|level|storey)\s+(\d+)/i);
  if (levelMatch) return `Level ${levelMatch[1]}`;

  // Already in good form or unrecognized — return as-is with title case
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Infer occupancy from storey name and elevation.
 */
function inferOccupancy(name: string, elevation: number): string {
  const lower = name.toLowerCase();
  if (lower.includes('parking') || lower.includes('garage')) return 'parking';
  if (lower.includes('basement')) return elevation < -3 ? 'parking' : 'basement';
  if (lower.includes('mechanical') || lower.includes('mech')) return 'mechanical';
  if (lower.includes('roof')) return 'roof';
  if (lower.includes('penthouse')) return 'penthouse';
  return 'residential';
}

/**
 * Check if a storey is parking/mechanical (allows larger floor heights).
 */
function isParking(storey: Storey): boolean {
  return storey.occupancy === 'parking' || storey.occupancy === 'mechanical';
}

/**
 * Calculate spacings between sorted grids along an axis.
 */
function calculateSpacings(grids: Grid[], axis: 'x' | 'y'): number[] {
  const sorted = [...grids].sort((a, b) => a[axis] - b[axis]);
  const spacings: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    spacings.push(Math.abs(sorted[i][axis] - sorted[i - 1][axis]));
  }
  return spacings;
}

/**
 * Validate grid spacings for consistency.
 */
function validateGridSpacings(spacings: number[], label: string, warnings: string[]): void {
  if (spacings.length === 0) return;

  const avg = spacings.reduce((s, v) => s + v, 0) / spacings.length;
  const maxDeviation = Math.max(...spacings.map(s => Math.abs(s - avg)));

  // If spacing varies by more than 50% of average, flag it
  if (avg > 0 && maxDeviation / avg > 0.5) {
    warnings.push(
      `${label}-axis grid spacing varies significantly: ` +
      `min ${Math.min(...spacings).toFixed(2)}m, max ${Math.max(...spacings).toFixed(2)}m, ` +
      `avg ${avg.toFixed(2)}m — verify against structural drawings`
    );
  }
}
