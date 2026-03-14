// server/helpers/storey-inference.ts
//
// WP-R3 FIX: Removed hardcoded floorHeight=3.2 and floorsGuess=4 defaults.
// If storey data cannot be inferred from element z-values, a critical RFI
// must be generated and an empty array returned.  BIM generation cannot
// proceed with fabricated storey layouts.
//
// Callers that require the FLOOR_HEIGHT_M opt-in (development only) must
// set NODE_ENV !== "production" AND provide FLOOR_HEIGHT_M explicitly.
// Production builds always return [] when storey data is absent.

import { registerMissingData } from "../estimator/rfi-generator";

type Storey = { name: string; elevation: number };

export function inferStoreysIfMissing(
  incomingStoreys: Storey[] | undefined,
  elements: any[],
  _opts?: { floorHeight?: number; floorsGuess?: number }
): Storey[] {
  // 1. Use supplied storeys if available
  if (Array.isArray(incomingStoreys) && incomingStoreys.length) return incomingStoreys;

  // 2. Infer from element z-values if at least 2 distinct elevations exist
  const zs = new Set<number>();
  for (const e of elements || []) {
    const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : e?.geometry;
    const p = g?.location?.realLocation;
    if (p && Number.isFinite(+p.z)) zs.add(+p.z);
  }
  if (zs.size >= 2) {
    const sorted = Array.from(zs).sort((a, b) => a - b);
    return sorted.map((z, i) => ({ name: `Level ${i}`, elevation: z }));
  }

  // 3. Development opt-in: only when FLOOR_HEIGHT_M is explicitly set
  //    AND we are not in production. Never falls back silently.
  const floorHeightEnv = process.env.FLOOR_HEIGHT_M;
  const isProduction = process.env.NODE_ENV === "production";

  if (!isProduction && floorHeightEnv) {
    const floorHeight = Number(floorHeightEnv);
    const floorsGuess = Math.max(1, Number(process.env.FLOORS_GUESS ?? 1));

    console.warn(
      `⚠️ [STOREY-INFERENCE] Development mode: synthesising ${floorsGuess} storeys ` +
      `at ${floorHeight}m from FLOOR_HEIGHT_M env var. ` +
      `This MUST be replaced by drawing-extracted data before production deployment.`
    );

    const out: Storey[] = [];
    for (let i = 0; i < floorsGuess; i++) {
      out.push({ name: `Level ${i}`, elevation: i * floorHeight });
    }
    return out;
  }

  // 4. No storey data available and no dev opt-in — register RFI and return empty.
  //    Callers must handle [] and halt BIM generation.
  registerMissingData({
    category: "dimension",
    description:
      "Floor-to-floor heights and storey count could not be determined. " +
      "Building section drawings and elevation drawings must be uploaded and " +
      "analysed before BIM element placement can proceed. " +
      "Set FLOOR_HEIGHT_M environment variable only for development environments.",
    csiDivision: "00 00 00",
    impact: "critical",
    drawingRef: "Building sections (A-series) and elevation drawings",
    costImpactLow: 0,
    costImpactHigh: 0,
    assumptionUsed: undefined,
    discoveredBy: "inferStoreysIfMissing",
  });

  console.error(
    "❌ [STOREY-INFERENCE] No storey data available and no dev opt-in. " +
    "Returning empty storey list. BIM generation must be halted. RFI registered."
  );

  return [];
}
