// server/helpers/analysis-merge.ts
import { normaliseElevation } from './unit-normaliser';
//
// Merges multiple per-batch Claude analysis results into one unified result.
//
// BUG FIXED (v15.4):
//   Previous implementation silently discarded floors[] and storeys[] arrays
//   returned by Claude. Those arrays are the ONLY source of per-floor element
//   lists consumed by RealQTOProcessor.generateElementsFromAIAnalysis().
//   Dropping them caused the floor-by-floor extraction loop to produce zero
//   elements even when Claude correctly returned detailed per-floor data.
//
// MERGE RULES:
//   elements[]        — deduplicated by stable key, order preserved
//   floors[]          — deduplicated by name; sub-arrays merged across batches
//   storeys[]         — deduplicated by name, order preserved
//   building_analysis — dimensions: max; perimeter: bounding box
//   All other top-level keys — last-write-wins across batches

export type ClaudeResult = {
  elements?: any[];
  floors?: any[];
  storeys?: any[];
  building_analysis?: any;
  analysis?: any;
  [key: string]: any;
};

function elementKey(e: any): string {
  return e?.id || `${e?.name || ""}|${e?.type || e?.category || ""}|${e?.storeyName || ""}`;
}

function floorKey(f: any): string {
  return (
    f?.name?.trim().toLowerCase() ||
    f?.level?.toString().trim().toLowerCase() ||
    String(f?.elevation ?? "??")
  );
}

export function mergeClaudeResults(parts: ClaudeResult[]): ClaudeResult {
  // Spread all top-level keys so nothing is silently lost (discovered_elements,
  // element_placements, drawing_analysis, footprint, grid, etc.)
  const out: ClaudeResult = {};
  for (const p of parts) {
    if (p && typeof p === "object") Object.assign(out, p);
  }

  // ── 1. Elements ────────────────────────────────────────────────────────────
  const mergedElements: any[] = [];
  const seenElementKeys = new Set<string>();
  for (const p of parts) {
    for (const e of p?.elements || []) {
      const k = elementKey(e);
      if (!k) { mergedElements.push(e); continue; }
      if (!seenElementKeys.has(k)) { seenElementKeys.add(k); mergedElements.push(e); }
    }
  }
  out.elements = mergedElements;

  // ── 2. Floors ─────────────────────────────────────────────────────────────
  // Per-floor objects consumed by generateElementsFromAIAnalysis:
  //   { name, level, elevation, ceiling_height, walls[], columns[], doors[], ... }
  const mergedFloors: any[] = [];
  const seenFloorKeys = new Set<string>();
  const SUB_ARRAYS = ["walls", "columns", "doors", "windows", "slabs", "mep", "stairs", "beams"];

  for (const p of parts) {
    for (const f of p?.floors || []) {
      const k = floorKey(f);
      if (!k || k === "??") { mergedFloors.push(f); continue; }
      if (!seenFloorKeys.has(k)) {
        seenFloorKeys.add(k);
        mergedFloors.push({ ...f });
      } else {
        // Same storey in a later batch — merge element sub-arrays
        const existing = mergedFloors.find(x => floorKey(x) === k);
        if (existing) {
          for (const arr of SUB_ARRAYS) {
            if (Array.isArray(f[arr]) && f[arr].length > 0) {
              existing[arr] = Array.isArray(existing[arr])
                ? [...existing[arr], ...f[arr]]
                : [...f[arr]];
            }
          }
        }
      }
    }
  }
  out.floors = mergedFloors;

  // ── 3. Storeys ─────────────────────────────────────────────────────────────
  // { name, elevation_m, floor_to_floor_height_m, … } — consumed by storey-resolver
  const mergedStoreys: any[] = [];
  const seenStoreyKeys = new Set<string>();

  for (const p of parts) {
    const storeyArray: any[] =
      p?.storeys ||
      p?.building_analysis?.storeys ||
      p?.analysis?.storeys ||
      [];
    for (const s of storeyArray) {
      const k = floorKey(s);
      if (!k || k === "??") { mergedStoreys.push(s); continue; }
      if (!seenStoreyKeys.has(k)) {
        seenStoreyKeys.add(k);
        // Normalise elevation to metres — Claude returns elevation_m, elevation (mm), or bare number
        const elevM = normaliseElevation({
          elevation_m:   s.elevation_m,
          elevation_mm:  s.elevation_mm,
          elevation_raw: (s.elevation_m === undefined && s.elevation_mm === undefined)
                         ? (s.elevation ?? 0) : undefined,
        });
        mergedStoreys.push({
          ...s,
          elevation_m: elevM ?? s.elevation_m ?? 0,
        });
      }
    }
  }
  out.storeys = mergedStoreys;

  // ── 4. Building analysis ──────────────────────────────────────────────────
  let dimsW = 0, dimsL = 0;
  let anyPerimeter = false;
  let minX = +Infinity, maxX = -Infinity, minZ = +Infinity, maxZ = -Infinity;

  for (const p of parts) {
    const a = p?.building_analysis || p?.analysis || {};
    if (a?.dimensions?.width)  dimsW = Math.max(dimsW, Number(a.dimensions.width));
    if (a?.dimensions?.length) dimsL = Math.max(dimsL, Number(a.dimensions.length));
    if (Array.isArray(a?.perimeter) && a.perimeter.length >= 3) {
      anyPerimeter = true;
      for (const v of a.perimeter) {
        const x = Number(v.x ?? v[0] ?? 0);
        const z = Number(v.z ?? v.y ?? v[1] ?? 0);
        if (Number.isFinite(x) && Number.isFinite(z)) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
    }
  }

  const mergedBA: any = {};
  for (const p of parts) {
    const a = p?.building_analysis || p?.analysis;
    if (a && typeof a === "object") Object.assign(mergedBA, a);
  }

  if (anyPerimeter && Number.isFinite(minX)) {
    mergedBA.perimeter = [
      { x: minX, z: minZ }, { x: maxX, z: minZ },
      { x: maxX, z: maxZ }, { x: minX, z: maxZ },
      { x: minX, z: minZ },
    ];
  } else if (dimsW && dimsL) {
    mergedBA.dimensions = { ...(mergedBA.dimensions || {}), width: dimsW, length: dimsL };
  }

  // Attach merged storey list so storey-resolver finds it inside building_analysis
  if (mergedStoreys.length > 0) mergedBA.storeys = mergedStoreys;

  out.building_analysis = mergedBA;
  return out;
}
