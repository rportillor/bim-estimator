// server/helpers/dimension-validator.ts
// =============================================================================
// POST-EXTRACTION DIMENSIONAL VALIDATION
// =============================================================================
//
// Validates that AI-extracted dimensions fall within plausible real-world ranges.
// Elements with out-of-range dimensions are flagged with RFI instead of silently
// accepted. Called after Claude extraction and before BIM storage.
//
// Ranges based on:
//   - IBC/NBC structural minimums
//   - CSA A23.3 concrete design
//   - Typical Canadian ICI construction (2-50 storey)
// =============================================================================

import { registerMissingData } from "../estimator/rfi-generator";

// ── Plausible dimension ranges (metres) ─────────────────────────────────────

interface DimRange {
  min: number;
  max: number;
  label: string;
}

const VALIDATION_RANGES: Record<string, {
  width?: DimRange;
  height?: DimRange;
  depth?: DimRange;
  thickness?: DimRange;
}> = {
  wall: {
    width:     { min: 0.3,   max: 200,  label: "wall length" },
    height:    { min: 2.0,   max: 12,   label: "wall height" },
    depth:     { min: 0.050, max: 0.8,  label: "wall thickness" },
    thickness: { min: 0.050, max: 0.8,  label: "wall thickness" },
  },
  column: {
    width:  { min: 0.150, max: 2.0,  label: "column width" },
    height: { min: 2.0,   max: 12,   label: "column height" },
    depth:  { min: 0.150, max: 2.0,  label: "column depth" },
  },
  beam: {
    width:  { min: 0.150, max: 1.5,  label: "beam width" },
    height: { min: 0.200, max: 2.5,  label: "beam depth" },
    depth:  { min: 0.5,   max: 30,   label: "beam span" },
  },
  slab: {
    width:  { min: 1.0,   max: 500,  label: "slab width" },
    height: { min: 0.075, max: 1.0,  label: "slab thickness" },
    depth:  { min: 1.0,   max: 500,  label: "slab depth" },
  },
  door: {
    width:  { min: 0.6,   max: 5.0,  label: "door width" },
    height: { min: 1.8,   max: 4.0,  label: "door height" },
    depth:  { min: 0.03,  max: 0.3,  label: "door thickness" },
  },
  window: {
    width:  { min: 0.3,   max: 10,   label: "window width" },
    height: { min: 0.3,   max: 5.0,  label: "window height" },
    depth:  { min: 0.01,  max: 0.3,  label: "window depth" },
  },
  stair: {
    width:  { min: 0.8,   max: 5.0,  label: "stair width" },
    height: { min: 2.0,   max: 8.0,  label: "stair height" },
    depth:  { min: 1.0,   max: 15,   label: "stair run" },
  },
  foundation: {
    width:  { min: 0.3,   max: 20,   label: "footing width" },
    height: { min: 0.2,   max: 3.0,  label: "footing depth" },
    depth:  { min: 0.3,   max: 20,   label: "footing length" },
  },
  roof: {
    width:  { min: 1.0,   max: 500,  label: "roof width" },
    height: { min: 0.05,  max: 2.0,  label: "roof thickness" },
    depth:  { min: 1.0,   max: 500,  label: "roof depth" },
  },
};

// Floor-to-floor height validation
const FLOOR_TO_FLOOR_RANGE = { min: 2.4, max: 8.0 };

// ── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  rfiCount: number;
  elementsValidated: number;
  elementsFlagged: number;
}

// ── Main validation function ─────────────────────────────────────────────────

/**
 * Validate dimensions of all extracted BIM elements.
 * Elements with out-of-range dimensions are flagged with rfi_flag=true
 * and an attentionReason explaining the violation.
 *
 * @returns ValidationResult with summary statistics
 */
export function validateExtractedDimensions(elements: any[]): ValidationResult {
  const warnings: string[] = [];
  let rfiCount = 0;
  let elementsFlagged = 0;

  for (const el of elements) {
    const type = (el.elementType || el.type || "").toLowerCase();
    const dims = el.geometry?.dimensions || el.properties?.dimensions;
    const elId = el.id || el.elementId || "unknown";

    if (!dims) continue; // No dimensions to validate

    // Find matching range config
    let rangeKey = "";
    for (const key of Object.keys(VALIDATION_RANGES)) {
      if (type.includes(key)) { rangeKey = key; break; }
    }
    if (!rangeKey) continue; // No validation rules for this type

    const ranges = VALIDATION_RANGES[rangeKey];
    const violations: string[] = [];

    // Check each dimension
    for (const [dimKey, range] of Object.entries(ranges)) {
      if (!range) continue;
      const value = Number(dims[dimKey] ?? dims[dimKey === "thickness" ? "depth" : ""]);
      if (!value || !isFinite(value)) continue;

      // Convert from mm if needed (values > 50 are likely mm)
      const valueM = value > 50 ? value / 1000 : value;

      if (valueM < range.min) {
        violations.push(`${range.label}=${valueM.toFixed(3)}m < minimum ${range.min}m`);
      } else if (valueM > range.max) {
        violations.push(`${range.label}=${valueM.toFixed(2)}m > maximum ${range.max}m`);
      }
    }

    if (violations.length > 0) {
      elementsFlagged++;
      const msg = `Element ${elId} (${type}): ${violations.join("; ")}`;
      warnings.push(msg);
      console.warn(`⚠️ [dim-validator] ${msg}`);

      // Flag element for QS review
      if (!el.properties) el.properties = {};
      el.properties.rfi_flag = true;
      el.properties.needs_attention = true;
      el.properties.attentionReason = `Dimension out of plausible range: ${violations.join("; ")}`;
      el.properties.dimensionValidation = "FAILED";

      rfiCount++;
    } else {
      if (!el.properties) el.properties = {};
      el.properties.dimensionValidation = "PASSED";
    }
  }

  if (rfiCount > 0) {
    registerMissingData({
      category: "dimension",
      description: `${rfiCount} element(s) have dimensions outside plausible construction ranges. ` +
        `QS review required: ${warnings.slice(0, 5).join("; ")}` +
        (warnings.length > 5 ? `... and ${warnings.length - 5} more` : ""),
      csiDivision: "00 00 00",
      impact: rfiCount > 10 ? "high" : "medium",
      drawingRef: "Structural drawings, wall type schedule, door/window schedule",
      costImpactLow: 0,
      costImpactHigh: 0,
      assumptionUsed: undefined,
      discoveredBy: "dimension-validator",
    });
  }

  return {
    valid: rfiCount === 0,
    warnings,
    rfiCount,
    elementsValidated: elements.length,
    elementsFlagged,
  };
}

/**
 * Validate floor-to-floor heights from storey data.
 * Returns warnings for any height outside the plausible range.
 */
export function validateStoreyHeights(storeys: Array<{ name: string; elevation: number }>): string[] {
  const warnings: string[] = [];
  if (storeys.length < 2) return warnings;

  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  for (let i = 1; i < sorted.length; i++) {
    const ftf = sorted[i].elevation - sorted[i - 1].elevation;
    if (ftf < FLOOR_TO_FLOOR_RANGE.min || ftf > FLOOR_TO_FLOOR_RANGE.max) {
      const msg = `Floor-to-floor ${sorted[i - 1].name} → ${sorted[i].name}: ${ftf.toFixed(2)}m ` +
        `(plausible range: ${FLOOR_TO_FLOOR_RANGE.min}–${FLOOR_TO_FLOOR_RANGE.max}m)`;
      warnings.push(msg);
      console.warn(`⚠️ [dim-validator] ${msg}`);
    }
  }

  return warnings;
}
