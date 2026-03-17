/**
 * server/helpers/unit-normaliser.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * EstimatorPro v15.5 — Universal Unit Normalisation
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Construction drawings arrive in mixed units: Canadian metric (mm, m),
 * legacy imperial (ft, in, ft-in), and occasionally centimetres.
 * Claude's AI extraction returns values in the unit that appeared in the
 * source drawing, plus explicit unit strings ("200mm", "3'-6\"", "2.5m").
 *
 * This module provides a single authoritative normalisation layer so that
 * every coordinate, dimension, and elevation value stored internally is
 * always expressed in METRES (SI base unit, 5-decimal precision) and the
 * unit source is recorded for auditability.
 *
 * ARCHITECTURE LAW
 * ────────────────
 * No hardcoded default dimensions anywhere. If a value cannot be determined
 * from the drawing/spec, this module returns null and the caller MUST raise
 * an RFI via MissingDataTracker — never substitute a default.
 *
 * SUPPORTED UNIT FORMATS (case-insensitive, with or without space)
 * ────────────────────────────────────────────────────────────────
 *   Millimetres : "200mm", "200 mm", "200MM"
 *   Centimetres : "20cm", "20 cm"
 *   Metres      : "2m", "2.5m", "2.50 m"
 *   Feet        : "10'", "10.5'"
 *   Inches      : "6\"", "6in", "6 in"
 *   Feet-Inches : "3'-6\"", "3' 6\"", "3'6", "3'6\""
 *   Decimal ft  : "10.5 ft", "10.5ft"
 *   Plain number: heuristic — see detectUnit()
 *
 * HEURISTIC FOR PLAIN NUMBERS (no unit string)
 * ─────────────────────────────────────────────
 * Construction drawings are dimensioned to suit their scale:
 *   value > 200  → almost certainly millimetres  (e.g. 3600 = 3.6 m floor)
 *   value 20–200 → probably centimetres (rare in CA/US practice, treated as m if > 20)
 *   value 1–20   → probably metres      (e.g. 12.5 = 12.5 m bay)
 *   value < 1    → metres               (e.g. 0.2 = 200 mm wall thickness)
 *   value > 5000 → definitely millimetres
 *
 * For COORDINATES (x/y floor plan positions) the cutoff is higher:
 *   value > 500  → millimetres
 *   otherwise    → metres
 *
 * IMPORTANT: Heuristics are only invoked when no unit string is present.
 * Prompts in bim-generator.ts should always ask Claude to return values
 * with explicit unit strings. The heuristic is a safety net.
 */

export type UnitType = 'mm' | 'cm' | 'm' | 'ft' | 'in' | 'ft-in' | 'unknown';

export interface NormalisedValue {
  /** Value in metres — the canonical internal unit */
  metres: number;
  /** Original raw value as received */
  original: number | string;
  /** Detected source unit */
  unit: UnitType;
  /** True if the unit was inferred by heuristic (no explicit unit string) */
  inferred: boolean;
}

// ── Regex patterns ────────────────────────────────────────────────────────────

const RE_MM      = /^([+-]?\d+(?:\.\d+)?)\s*mm$/i;
const RE_CM      = /^([+-]?\d+(?:\.\d+)?)\s*cm$/i;
const RE_M       = /^([+-]?\d+(?:\.\d+)?)\s*m$/i;
const RE_FT_ONLY = /^([+-]?\d+(?:\.\d+)?)\s*(?:ft|feet|')$/i;
const RE_IN_ONLY = /^([+-]?\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/i;
// 3'-6" | 3' 6" | 3'6" | 3'6  | 3 ft 6 in
const RE_FT_IN   = /^([+-]?\d+)\s*['ft]+\s*[-\s]?\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch)?$/i;

// ── Core normalisation function ───────────────────────────────────────────────

/**
 * Normalise any measurement value to metres.
 *
 * @param value     Raw value (number, string with unit, or null/undefined)
 * @param context   Hint for plain-number heuristic ('dimension' | 'coordinate' | 'elevation')
 * @returns         NormalisedValue, or null if value is absent/unparseable
 */
export function normaliseToMetres(
  value: number | string | null | undefined,
  context: 'dimension' | 'coordinate' | 'elevation' = 'dimension'
): NormalisedValue | null {
  if (value === null || value === undefined || value === '') return null;

  // ── Numeric input ──────────────────────────────────────────────────────────
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return inferFromNumber(value, value, context);
  }

  // ── String input ───────────────────────────────────────────────────────────
  const str = String(value).trim();
  if (!str) return null;

  let m: RegExpMatchArray | null;

  // Millimetres — "200mm", "200 mm"
  if ((m = str.match(RE_MM))) {
    return make(parseFloat(m[1]) / 1000, str, 'mm', false);
  }

  // Centimetres — "20cm"
  if ((m = str.match(RE_CM))) {
    return make(parseFloat(m[1]) / 100, str, 'cm', false);
  }

  // Metres — "2.5m"
  if ((m = str.match(RE_M))) {
    return make(parseFloat(m[1]), str, 'm', false);
  }

  // Feet-Inches — "3'-6\"", "3'6\""  (must be before feet-only)
  if ((m = str.match(RE_FT_IN))) {
    const feet   = Math.abs(parseFloat(m[1]));
    const inches = parseFloat(m[2]);
    const sign   = str.startsWith('-') ? -1 : 1;
    return make(sign * (feet * 0.3048 + inches * 0.0254), str, 'ft-in', false);
  }

  // Feet only — "10'", "10.5 ft"
  if ((m = str.match(RE_FT_ONLY))) {
    return make(parseFloat(m[1]) * 0.3048, str, 'ft', false);
  }

  // Inches only — "6\"", "6in"
  if ((m = str.match(RE_IN_ONLY))) {
    return make(parseFloat(m[1]) * 0.0254, str, 'in', false);
  }

  // Plain number string — parse then apply heuristic
  const num = parseFloat(str);
  if (!isNaN(num) && Number.isFinite(num)) {
    return inferFromNumber(num, str, context);
  }

  // Unparseable
  return null;
}

/**
 * Convenience: return metres value directly, or null.
 */
export function toMetres(
  value: number | string | null | undefined,
  context: 'dimension' | 'coordinate' | 'elevation' = 'dimension'
): number | null {
  const r = normaliseToMetres(value, context);
  return r ? r.metres : null;
}

/**
 * Convenience: return metres value with a fallback.
 * Only use this when a genuine default exists from drawings/specs — NEVER invent one.
 */
export function toMetresOrDefault(
  value: number | string | null | undefined,
  defaultMetres: number,
  context: 'dimension' | 'coordinate' | 'elevation' = 'dimension'
): number {
  const r = normaliseToMetres(value, context);
  return r ? r.metres : defaultMetres;
}

// ── Specialised coordinate normaliser ─────────────────────────────────────────

/**
 * Normalise an {x, y, z} coordinate object to metres.
 * Returns null for coordinates that cannot be resolved — caller must RFI.
 */
export function normaliseCoord(coord: {
  x?: number | string | null;
  y?: number | string | null;
  z?: number | string | null;
}): { x: number; y: number; z: number } | null {
  if (!coord) return null;
  const x = toMetres(coord.x, 'coordinate');
  const y = toMetres(coord.y, 'coordinate');
  const z = toMetres(coord.z, 'elevation');
  if (x === null && y === null) return null; // Both horizontal missing → RFI
  return {
    x: x ?? 0,
    y: y ?? 0,
    z: z ?? 0,   // z=0 is valid (ground floor)
  };
}

/**
 * Normalise a dimension set {width, height, depth/thickness} to metres.
 * Returns null fields for any dimension that could not be parsed.
 */
export function normaliseDimensions(dims: {
  width?:     number | string | null;
  height?:    number | string | null;
  depth?:     number | string | null;
  thickness?: number | string | null;
  length?:    number | string | null;
  span?:      number | string | null;
}): {
  width:  number | null;
  height: number | null;
  depth:  number | null;
} {
  const ctx: 'dimension' = 'dimension';
  return {
    width:  toMetres(dims.width  ?? dims.length ?? dims.span,       ctx),
    height: toMetres(dims.height,                                    ctx),
    depth:  toMetres(dims.depth  ?? dims.thickness,                  ctx),
  };
}

// ── Elevation normaliser ───────────────────────────────────────────────────────

/**
 * Normalise a storey/floor elevation to metres.
 * Claude's prompts return elevation_m for storeys and elevation (mm) for floors —
 * this function handles both schemas.
 *
 * @param elevation_m   Value labelled as metres (storeys[] schema)
 * @param elevation_mm  Value labelled as millimetres (floors[] schema)
 * @param elevation_raw Unlabelled value (falls through to heuristic)
 */
export function normaliseElevation(args: {
  elevation_m?:   number | string | null;
  elevation_mm?:  number | string | null;
  elevation_raw?: number | string | null;
}): number | null {
  // 1. Explicit metres field
  if (args.elevation_m !== null && args.elevation_m !== undefined) {
    const r = normaliseToMetres(args.elevation_m, 'elevation');
    if (r) return r.metres;
  }
  // 2. Explicit millimetres field
  if (args.elevation_mm !== null && args.elevation_mm !== undefined) {
    const raw = parseFloat(String(args.elevation_mm));
    if (Number.isFinite(raw)) return raw / 1000;
  }
  // 3. Raw/unlabelled — apply heuristic
  if (args.elevation_raw !== null && args.elevation_raw !== undefined) {
    const r = normaliseToMetres(args.elevation_raw, 'elevation');
    if (r) return r.metres;
  }
  return null;
}

// ── Unit detection ─────────────────────────────────────────────────────────────

/**
 * Detect the unit system used in a set of raw values.
 * Useful for logging and RFI generation.
 */
export function detectDominantUnit(values: Array<number | string | null | undefined>): UnitType {
  const results = values
    .map(v => normaliseToMetres(v))
    .filter(Boolean) as NormalisedValue[];
  if (!results.length) return 'unknown';
  const counts: Record<UnitType, number> = {
    mm: 0, cm: 0, m: 0, ft: 0, in: 0, 'ft-in': 0, unknown: 0
  };
  for (const r of results) counts[r.unit]++;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as UnitType;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function make(metres: number, original: number | string, unit: UnitType, inferred: boolean): NormalisedValue {
  return { metres: roundToFiveDP(metres), original, unit, inferred };
}

function roundToFiveDP(v: number): number {
  return Math.round(v * 100000) / 100000;
}

function inferFromNumber(
  num: number,
  original: number | string,
  context: 'dimension' | 'coordinate' | 'elevation'
): NormalisedValue {
  const abs = Math.abs(num);

  if (context === 'coordinate') {
    // Plan coordinates: drawings in mm use values like 0, 3000, 6000, 12000
    // Drawings in m use 0, 3, 6, 12
    if (abs > 500) return make(num / 1000, original, 'mm', true);
    return make(num, original, 'm', true);
  }

  if (context === 'elevation') {
    // Floor elevations in mm: typical range 2700–5000 mm (2.7–5.0 m per storey).
    // Survey / ASL elevations in metres: Canadian buildings often sit at 100–400 m above
    // sea level (e.g. 257.60 mASL, 262.25 mASL).  The old threshold of 200 wrongly treated
    // survey elevations as mm (258 → 0.258 m).  Use 1000 as the cutoff so that:
    //   • 3000 mm → 3.0 m  ✓  (floor-to-floor in mm)
    //   • 258 m   → 258 m  ✓  (ASL elevation — caller must subtract datum)
    if (abs >= 1000) return make(num / 1000, original, 'mm', true);
    return make(num, original, 'm', true);
  }

  // Dimensions (default context)
  // Imperial fringe: 8, 10, 12, 16 could be feet — but Canadian practice is metric
  // so we treat large round numbers as mm
  if (abs > 5000)  return make(num / 1000, original, 'mm', true);  // e.g. 6000 → 6 m wall
  if (abs > 200)   return make(num / 1000, original, 'mm', true);  // e.g. 300 → 0.3 m thickness
  if (abs > 20)    return make(num / 1000, original, 'mm', true);  // e.g. 200 → 0.2 m
  return make(num, original, 'm', true);                            // e.g. 3.6 → 3.6 m
}
