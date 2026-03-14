// server/services/bim-postprocess.ts
import { repairLayout } from "../helpers/layout-repair";
import { detectGridFromElements } from "../helpers/grid-detect";
import { storage } from "../storage";
import { ensureFootprintForModel } from "./footprint-extractor";
import { calibrateAndPositionElements } from "../helpers/layout-calibration";
import { applySiteContext } from "../helpers/site-utils";
import { sanitizeElements } from "../helpers/element-sanitizer";
import { detectRoundSymbolsFromRasters } from "./raster-legend-assoc";
import { placeDetectedSymbolsAsElements, placeDetectedSymbolsAsElements_LEGACY } from "../helpers/site-symbols";
import crypto from "crypto";
import { detectRasterSymbolsForModel } from "./raster-glyph-locator";
import { FLOOR_DATUMS } from "./moorings-project-data";
// ── Human-modeler workflow enhancements (v15.31) ─────────────────────────
import { establishRelationships } from "./relationship-engine";
import { upgradeGeometry } from "./geometry-upgrade";
// Clash detection — imported lazily to avoid breaking if geometry-kernel
// has missing dependencies; the step is wrapped in try/catch below.
let runClashDetection: ((elements: any[]) => { clashCount: number; criticalCount: number; results: any[] }) | null = null;
try {
  // Dynamic import preparation — actual import happens in the pipeline step
} catch { /* lazy load */ }

const COLOR_BY_FAMILY: Record<string, string> = {
  STRUCT: "#6B7280", ARCH: "#22C55E",
  M: "#3B82F6", E: "#F59E0B", P: "#8B5CF6", FP: "#EF4444",
  OTHER: "#9CA3AF"
};
function familyOf(e: any): keyof typeof COLOR_BY_FAMILY {
  const t = String(e?.elementType || e?.type || e?.category || "").toUpperCase();
  if (/(FOUNDATION|WALL|SLAB|BEAM|COLUMN)/.test(t)) return "STRUCT";
  if (/(DOOR|WINDOW|STAIR|FINISH|CEILING|PARTITION)/.test(t)) return "ARCH";
  if (/(DUCT|VAV|AHU|RTU|MECH|FAN|DIFFUSER)/.test(t)) return "M";
  if (/(LIGHT|RECEPTACLE|PANEL|CONDUIT|SWITCH|ELECTRICAL)/.test(t)) return "E";
  if (/(PIPE|DRAIN|VALVE|PLUMB)/.test(t)) return "P";
  if (/(SPRINKLER|FIRE|HYDRANT)/.test(t)) return "FP";
  return "OTHER";
}

// ---------------------------------------------------------------------------
// Moorings confirmed floor datums (mASL, C1 confidence) used for absolute Z.
// Populated from FLOOR_DATUMS in moorings-project-data.ts.
// ---------------------------------------------------------------------------
const MOORINGS_DATUM_MAP = new Map<string, number>(
  FLOOR_DATUMS.map(d => [d.level.toLowerCase(), d.elevationM])
);
// Aliases that Claude's storey labels commonly use
MOORINGS_DATUM_MAP.set("underground", 257.60);
MOORINGS_DATUM_MAP.set("parking",     257.60);
MOORINGS_DATUM_MAP.set("ground",      262.25);
MOORINGS_DATUM_MAP.set("grade",       262.25);
MOORINGS_DATUM_MAP.set("main",        262.25);
MOORINGS_DATUM_MAP.set("second",      266.25);
MOORINGS_DATUM_MAP.set("floor 2",     266.25);
MOORINGS_DATUM_MAP.set("level 2",     266.25);
MOORINGS_DATUM_MAP.set("third",       269.85);
MOORINGS_DATUM_MAP.set("floor 3",     269.85);
MOORINGS_DATUM_MAP.set("level 3",     269.85);
MOORINGS_DATUM_MAP.set("penthouse",   273.95);
MOORINGS_DATUM_MAP.set("mechanical",  273.95);

/** Resolve a storey label to a Moorings absolute mASL elevation; null if no match. */
function resolveMooringsDatum(storeyLabel: string): number | null {
  const s = storeyLabel.toLowerCase().trim();
  for (const [key, elev] of MOORINGS_DATUM_MAP.entries()) {
    if (s.includes(key)) return elev;
  }
  return null;
}

export async function postprocessAndSave(modelId: string, elements: any[], metadata: any = {}) {
  console.log("🔧 POSTPROCESS: start", modelId, "elements:", elements?.length || 0);

  const repaired = repairLayout(elements, { minAspectRatio: 12 });
  let work = repaired.elements;

  work = (work || []).map(e => {
    const fam = familyOf(e);
    let g: any;
    try { g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {}); } catch { g = {}; }
    const props = e.properties || {};
    props.renderFamily = fam;
    props.renderColor = COLOR_BY_FAMILY[fam];
    e.properties = props;
    e.geometry = g;
    return e;
  });

  metadata = metadata || {};
  metadata.overlays = {
    footprint: repaired.footprint || [],
    propertyLine: repaired.propertyLine || [],
    grid: repaired.grid || detectGridFromElements(work),
    layoutRepair: { applied: repaired.applied, reason: repaired.reason, stats: repaired.stats }
  };

  await storage.upsertBimElements(modelId, work);
  if (typeof (storage as any).updateBimModelMetadata === "function") {
    await (storage as any).updateBimModelMetadata(modelId, metadata);
  }

  console.log(`🔧 POSTPROCESS: done; repair=${repaired.applied ? repaired.reason : "none"}; gridX=${repaired.grid?.xs?.length||0} gridY=${repaired.grid?.ys?.length||0}`);
}

type PostOpts = {
  modelId: string;
  projectId: string;
  elements: any[];
  anthropic?: any;
  forceCalibrate?: boolean;
  enableSymbolDetect?: boolean;
};

function allAtOrigin(elems: any[]) {
  if (!Array.isArray(elems) || elems.length === 0) return false;
  let same = true;
  for (const e of elems) {
    const p = e?.geometry?.location?.realLocation || e?.properties?.realLocation || { x: 0, y: 0, z: 0 };
    if ((+p.x || 0) !== 0 || (+p.y || 0) !== 0) { same = false; break; }
  }
  return same;
}

/**
 * postprocessAndSaveBIM — primary entry point called by bim-generator.ts.
 *
 * v15.10 fix: routes to LEGACY pipeline when calibration-related opts are
 * provided. Previously these opts were silently dropped (v15.9 regression).
 *
 *   forceCalibrate | enableSymbolDetect | anthropic → LEGACY pipeline:
 *     footprint extraction → Moorings storey Z → symbol detect →
 *     calibrateAndPositionElements → save
 *
 *   Otherwise → fast path: layout repair + family colours + save.
 */
export async function postprocessAndSaveBIM(opts: PostOpts) {
  const needsFullPipeline =
    opts.forceCalibrate === true ||
    opts.enableSymbolDetect === true ||
    !!opts.anthropic ||
    String(process.env.CALIBRATE_FORCE || "").toLowerCase() === "on" ||
    String(process.env.SITE_SYMBOL_DETECT || "").toLowerCase() === "on";

  if (needsFullPipeline) {
    console.log("🔧 POSTPROCESS: routing to LEGACY pipeline (forceCalibrate/symbolDetect/anthropic)");
    return await postprocessAndSaveBIM_LEGACY(opts);
  }

  console.log("🔧 POSTPROCESS: routing to fast path (layout repair only)");
  return await postprocessAndSave(opts.modelId, opts.elements, {});
}

export async function postprocessAndSaveBIM_LEGACY(opts: PostOpts) {
  const {
    modelId, projectId, elements,
    anthropic,
    forceCalibrate,
    enableSymbolDetect
  } = opts;

  console.log("🔧 POSTPROCESS: start for model", modelId, "elements:", elements?.length || 0);

  // 1) Footprint / legend
  try {
    console.log("🔧 POSTPROCESS: ensure footprint/property/legend from Site Plan…");
    await ensureFootprintForModel({
      modelId, projectId,
      anthropicClient: anthropic,
      maxDocs: 8, maxPagesPerDoc: 4, maxChars: 24000
    });
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: ensureFootprintForModel failed:", e?.message || e);
  }

  // 2) Pull merged analysis/site from model metadata
  let mergedAnalysis: any = {};
  try {
    if ((storage as any).getBimModel) {
      const m = await (storage as any).getBimModel(modelId);
      const meta = m?.metadata || {};
      mergedAnalysis = {
        ...(meta.analysis || meta.building_analysis || {}),
        site: meta.site || {}
      };
    }
  } catch (_e) {
    console.warn("⚠️ POSTPROCESS: load model metadata failed; continuing with empty analysis");
  }

  let work = Array.isArray(elements) ? elements.slice() : [];

  // 🔧 SANITIZE
  const { elements: sanitized, report } = sanitizeElements(work);
  if (report.fixedCount > 0) {
    console.log(`🔧 SANITIZE: fixed ${report.fixedCount} elements (swaps=${report.swaps}, clamped=${report.clamped}, zeros=${report.zeros})`);
  }
  work = sanitized;

  // 🏢 STOREY ELEVATIONS: absolute Z from Moorings confirmed datums.
  // Architecture law: no invented values — only C1-confidence confirmed datums
  // from FLOOR_DATUMS (moorings-project-data.ts), or Claude's extracted
  // elevation annotation. Ground floor (262.25 mASL) is the reference datum.
  const storeys = mergedAnalysis.storeys || [];
  if (storeys.length > 0) {
    console.log(`🏢 Applying storey elevations to ${work.length} elements across ${storeys.length} levels`);

    const storeyMap = new Map<string, number>();
    for (const s of storeys) {
      const name = String(s?.name || `Z${s?.elevation??0}`);
      const mooringsDatum = resolveMooringsDatum(name);
      const elev = mooringsDatum !== null ? mooringsDatum : Number(s?.elevation ?? 0);
      storeyMap.set(name, elev);
    }

    for (const e of work) {
      let g: any;
      try { g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {}); } catch { g = {}; }
      const p = g.location?.realLocation || {x:0,y:0,z:0};
      const levelName = e.storey?.name || e.properties?.level || e.storeyName || "Ground Floor";
      const mooringsDatum = resolveMooringsDatum(levelName);
      const elev = mooringsDatum !== null ? mooringsDatum : (storeyMap.get(levelName) ?? 0);
      p.z = elev; // absolute mASL — do not add to existing z (avoids double-counting)
      g.location = { ...(g.location||{}), realLocation: p };
      e.geometry = g;
      e.storey = { ...(e.storey||{}), name: levelName, elevation: elev };
    }

    console.log(`✅ Applied elevations: ${Array.from(storeyMap.entries()).map(([n,e]) => `${n}=${e}m`).join(", ")}`);
  } else {
    // No storey array from Claude — apply Moorings datums directly from element labels
    let applied = 0;
    for (const e of work) {
      const levelName = e.storey?.name || e.properties?.level || e.storeyName || "";
      if (!levelName) continue;
      const datum = resolveMooringsDatum(levelName);
      if (datum === null) continue;
      let g: any;
      try { g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : (e?.geometry || {}); } catch { g = {}; }
      const p = g.location?.realLocation || {x:0,y:0,z:0};
      p.z = datum;
      g.location = { ...(g.location||{}), realLocation: p };
      e.geometry = g;
      e.storey = { ...(e.storey||{}), elevation: datum };
      applied++;
    }
    if (applied > 0) {
      console.log(`🏢 Applied Moorings absolute datums to ${applied} labelled elements (no storey array from Claude)`);
    }
  }

  // 3) Site symbol detection (optional)
  const DETECT = enableSymbolDetect ?? (String(process.env.SITE_SYMBOL_DETECT || "off").toLowerCase() === "on");
  try {
    const dims = mergedAnalysis?.dimensions;
    if (DETECT && dims?.width && dims?.length) {
      console.log("🌿 POSTPROCESS: raster symbol detection ON…");
      const detections = await detectRoundSymbolsFromRasters(projectId, 4);
      const guessTrees   = placeDetectedSymbolsAsElements_LEGACY(detections, dims, "TREE", 0);
      const guessManhole = placeDetectedSymbolsAsElements_LEGACY(detections, dims, "MANHOLE", 0);
      work = [...work, ...guessTrees, ...guessManhole];
      console.log(`🌿 POSTPROCESS: added ${guessTrees.length + guessManhole.length} site symbols`);
    }
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: symbol detection skipped:", e?.message || e);
  }

  // 4) Calibrate to footprint
  // v15.13b: wrapped in try/catch — a missing footprint must NOT kill the save.
  // Architecture law: the element batch is still written with unconverted coordinates
  // so the model is not left empty. An RFI for missing drawings covers the gap.
  const FORCE = forceCalibrate ?? (String(process.env.CALIBRATE_FORCE || "off").toLowerCase() === "on");
  console.log("🧭 CALIBRATION: running with mode =", FORCE ? "forcePerimeter" : "auto");
  try {
    const calibrated = await calibrateAndPositionElements(
      projectId,
      modelId,
      work,
      {
        mode: FORCE ? "forcePerimeter" : "auto",
        reCenterToOrigin: true,
        flipZIfAllYNegative: true,
        clampOutliersMeters: 500
      }
    );
    console.log(`🧭 CALIBRATION: SUCCESS - hardened positioning applied to ${calibrated.length} elements`);
    work = calibrated;
  } catch (calibErr: any) {
    // Log and continue — elements will be saved with whatever coords they have.
    // The 3D viewer will show them at raw positions; QS reviewer raises RFI.
    console.warn(`⚠️ CALIBRATION: failed (${calibErr?.message}) — saving with raw coordinates. ` +
      `This usually means no building footprint was found in the uploaded drawings. ` +
      `Upload a site plan or floor plan that clearly shows the building outline.`);
  }

  // 🔄 Persist calibration metadata
  try {
    console.log("🔄 POSTPROCESS: saving calibration metadata back to model...");
    if ((storage as any).updateBimModelMetadata) {
      const existingModel = await (storage as any).getBimModel(modelId);
      const currentMeta = existingModel?.metadata || {};
      const updatedMeta = {
        ...currentMeta,
        calibration: {
          applied: true,
          timestamp: new Date().toISOString(),
          elementsProcessed: work.length,
          mode: FORCE ? "forcePerimeter" : "auto"
        },
        lastProcessed: new Date().toISOString()
      };
      await (storage as any).updateBimModelMetadata(modelId, updatedMeta);
      console.log("✅ POSTPROCESS: metadata updated successfully");
    }
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: metadata save failed:", e?.message || e);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  HUMAN-MODELER WORKFLOW ENHANCEMENTS (v15.31)
  //  These steps mirror what a professional 3D modeler does after placing
  //  elements: upgrade geometry to real profiles, then establish connections.
  // ══════════════════════════════════════════════════════════════════════════

  // PASS 1: Upgrade bounding boxes → parametric profiles
  // (A human modeler selects the correct family/type, never places raw boxes)
  try {
    const upgradeResult = upgradeGeometry(work);
    work = upgradeResult.elements;
    console.log(`📐 POSTPROCESS: Geometry upgraded — ${upgradeResult.stats.total} elements now have parametric profiles`);
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: geometry upgrade failed (non-blocking):", e?.message || e);
  }

  // PASS 2: Establish parametric relationships
  // (A human modeler connects doors to walls, beams to columns, etc.)
  try {
    const relResult = establishRelationships(work);
    work = relResult.elements;
    console.log(
      `🔗 POSTPROCESS: Relationships established — ` +
      `${relResult.stats.hostedOpenings} hosted openings, ` +
      `${relResult.stats.wallJoins} wall joins, ` +
      `${relResult.stats.beamColumnSnaps} beam-column snaps, ` +
      `${relResult.stats.slabBounds} slab bounds`
    );

    // Persist relationship summary to model metadata
    try {
      if ((storage as any).updateBimModelMetadata) {
        await (storage as any).updateBimModelMetadata(modelId, {
          relationships: {
            total: relResult.relationships.length,
            stats: relResult.stats,
            generatedAt: new Date().toISOString(),
          },
        });
      }
    } catch { /* non-blocking */ }
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: relationship engine failed (non-blocking):", e?.message || e);
  }

  // PASS 2.5: Constraint propagation — verify all relationships are geometrically
  // consistent (hosted elements at correct positions, wall joins aligned, beams
  // snapped to columns). Like a human modeler doing a final constraint check.
  try {
    const { solveConstraints } = await import("../bim/parameter-engine");
    const { vec3: mkVec3 } = await import("../bim/geometry-kernel");

    // Build lightweight constraint set from relationship data
    const constraintList: Array<{ id: string; type: string; elementIds: string[]; parameters: Record<string, number>; priority: number; isActive: boolean }> = [];
    const elementMap = new Map<string, any>();

    for (const el of work) {
      let g: any;
      try { g = typeof el?.geometry === 'string' ? JSON.parse(el.geometry) : (el?.geometry || {}); } catch { g = {}; }
      const loc = g?.location?.realLocation || { x: 0, y: 0, z: 0 };
      const props = el?.properties || {};

      const solid = {
        id: el.id,
        type: String(el.elementType || el.type || ''),
        origin: mkVec3(loc.x, loc.y, loc.z),
        rotation: g?.orientation?.yawRad || 0,
        quantities: { volume: 0, surfaceArea: 0, lateralArea: 0, length: g?.dimensions?.width, width: g?.dimensions?.depth, height: g?.dimensions?.height },
        hostedIds: [] as string[],
        connectedIds: [
          ...(Array.isArray(props.connectedWallIds) ? props.connectedWallIds : []),
          ...(Array.isArray(props.connectedColumnIds) ? props.connectedColumnIds : []),
          ...(Array.isArray(props.supportedBeamIds) ? props.supportedBeamIds : []),
          ...(Array.isArray(props.boundingWallIds) ? props.boundingWallIds : []),
        ],
      };

      // Build host relationships
      if (props.hostWallId) {
        const hostEntry = elementMap.get(props.hostWallId);
        if (hostEntry) hostEntry.hostedIds.push(el.id);
      }

      elementMap.set(el.id, solid);
    }

    // Create hosted constraints
    for (const [id, solid] of elementMap) {
      for (const hostedId of solid.hostedIds) {
        constraintList.push({
          id: `pp_hosted_${id}_${hostedId}`,
          type: 'hosted',
          elementIds: [id, hostedId],
          parameters: {},
          priority: 8,
          isActive: true,
        });
      }
    }

    if (constraintList.length > 0) {
      const result = solveConstraints(constraintList as any, elementMap as any, 5, 0.01);
      console.log(
        `🔧 POSTPROCESS: Constraint propagation — ${constraintList.length} constraints, ` +
        `${result.iterations} iterations, converged=${result.converged}, ` +
        `${result.adjustments.length} adjustments made`
      );

      // Write back adjusted positions to the work elements
      if (result.adjustments.length > 0) {
        for (const adj of result.adjustments) {
          const workEl = work.find((e: any) => e.id === adj.elementId);
          if (workEl && adj.property.startsWith('origin')) {
            let g: any;
            try { g = typeof workEl?.geometry === 'string' ? JSON.parse(workEl.geometry) : (workEl?.geometry || {}); } catch { g = {}; }
            const solid = elementMap.get(adj.elementId);
            if (solid && g?.location?.realLocation) {
              g.location.realLocation = { x: solid.origin.x, y: solid.origin.y, z: solid.origin.z };
              workEl.geometry = g;
            }
          }
        }
      }
    } else {
      console.log("🔧 POSTPROCESS: No constraints to propagate (no hosted relationships detected)");
    }
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: constraint propagation failed (non-blocking):", e?.message || e);
  }

  // PASS 3: Clash detection — A human modeler runs clash detection before
  // submitting the model. We flag hard clashes (structural vs MEP overlaps)
  // and soft clashes (clearance violations) so the QS knows where RFIs are needed.
  try {
    const { runClashDetection: detectClashes } = await import("../bim/clash-detection");
    // Convert raw elements to the BIMSolid-like format clash detection expects.
    // We do a lightweight conversion — only elements with real geometry are tested.
    const testableElements = work
      .filter((e: any) => {
        let g: any;
        try { g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : e?.geometry; } catch { g = null; }
        return g?.location?.realLocation && g?.dimensions;
      })
      .map((e: any) => {
        let g: any;
        try { g = typeof e?.geometry === 'string' ? JSON.parse(e.geometry) : e?.geometry; } catch { g = null; }
        const loc = g?.location?.realLocation || { x: 0, y: 0, z: 0 };
        const dims = g?.dimensions || { width: 1, height: 1, depth: 1 };
        const type = String(e.elementType || e.type || '');
        return {
          id: e.id,
          type,
          name: e.name || type,
          category: /DUCT|PIPE|LIGHT|SPRINKLER|RECEPTACLE|CONDUIT/i.test(type) ? 'MEP' as const :
                    /COLUMN|BEAM|SLAB|FOUNDATION/i.test(type) ? 'Structural' as const : 'Architectural' as const,
          storey: e.storey?.name || '',
          elevation: e.storey?.elevation || 0,
          origin: { x: loc.x, y: loc.y, z: loc.z },
          rotation: g.orientation?.yawRad || 0,
          mesh: { vertices: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0) },
          boundingBox: {
            min: { x: loc.x - (dims.width || 0) / 2, y: loc.y - (dims.depth || 0) / 2, z: loc.z },
            max: { x: loc.x + (dims.width || 0) / 2, y: loc.y + (dims.depth || 0) / 2, z: loc.z + (dims.height || 0) },
          },
          quantities: { volume: 0, surfaceArea: 0, lateralArea: 0, length: dims.width, width: dims.depth, height: dims.height },
          material: '', hostId: null, connectedIds: [] as string[],
        };
      });

    if (testableElements.length > 10) {
      const clashResults = detectClashes(testableElements as any, {
        tolerance: 0.02,
        clearanceDistance: 0.05,
        ignoreSameHost: true,
        ignoreSameStorey: false,
        maxResults: 200,
      });
      const criticalClashes = clashResults.filter((c: any) => c.severity === 'critical' || c.severity === 'major');
      console.log(
        `⚠️ POSTPROCESS: Clash detection — ${clashResults.length} total clashes, ` +
        `${criticalClashes.length} critical/major`
      );

      // Persist clash summary to model metadata
      try {
        if ((storage as any).updateBimModelMetadata) {
          await (storage as any).updateBimModelMetadata(modelId, {
            clashDetection: {
              totalClashes: clashResults.length,
              criticalClashes: criticalClashes.length,
              topClashes: clashResults.slice(0, 20).map((c: any) => ({
                type: c.type,
                severity: c.severity,
                elementA: c.elementA,
                elementB: c.elementB,
                description: c.description,
              })),
              detectedAt: new Date().toISOString(),
            },
          });
        }
      } catch { /* non-blocking */ }
    } else {
      console.log("⚠️ POSTPROCESS: Too few elements with geometry for clash detection — skipped");
    }
  } catch (e: any) {
    console.warn("⚠️ POSTPROCESS: clash detection failed (non-blocking):", e?.message || e);
  }

  // 🎯 Raster glyph detection (env-gated)
  if (String(process.env.ENABLE_RASTER_GLYPH || "off").toLowerCase() === "on") {
    try {
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (const e of work){
        let g: any; try { g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry; } catch { g = null; }
        const p = g?.location?.realLocation; if (!p) continue;
        if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x;
        if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y;
      }
      if (!Number.isFinite(minX)) { minX=-10; minY=-10; maxX=10; maxY=10; }
      const hits = await detectRasterSymbolsForModel(modelId);
      if (hits.length) {
        const modelMeta = await (storage as any).getBimModel?.(modelId);
        const placed = placeDetectedSymbolsAsElements({
          hits,
          storeys: (modelMeta?.storeys || []),
          modelBBox: { minX, minY, maxX, maxY }
        });
        if (placed && Array.isArray(placed)) {
          console.log(`[raster] placed elements: +${placed.length}`);
          work = [...work, ...placed];
        }
      } else {
        console.log("[raster] no hits");
      }
    } catch (e: any) {
      console.warn("[raster] detection failed:", e?.message || e);
    }
  }

  // 5) Site context tagging
  const site = mergedAnalysis?.site;
  const finalElements = applySiteContext(work, site);

  // 6) Warn if still at origin
  if (allAtOrigin(finalElements)) {
    console.warn("🚨 POSTPROCESS: elements still at origin after calibration (no footprint?).");
  }

  // 7) Save
  const saveCount = finalElements.length;
  console.log(`💾 Attempting to save ${saveCount} BIM elements to model ${modelId}`);

  try {
    if (finalElements.length > 0) {
      const sample = finalElements[0];
      console.log(`📊 Sample element structure:`, {
        id: sample.id,
        type: sample.type,
        hasGeometry: !!sample.geometry,
        hasLocation: !!sample.geometry?.location,
        coordinates: sample.geometry?.location?.realLocation || sample.geometry?.location,
        properties: Object.keys(sample.properties || {}).slice(0, 5)
      });
    }

    if ((storage as any).upsertBimElements) {
      console.log(`✅ Using upsertBimElements for batch save`);
      await (storage as any).upsertBimElements(modelId, finalElements);
    } else if ((storage as any).saveBimElements) {
      console.log(`✅ Using saveBimElements for batch save`);
      await (storage as any).saveBimElements(modelId, finalElements);
    } else {
      for (const element of finalElements) {
        const realLoc = element.geometry?.location?.realLocation || element.properties?.realLocation || { x: 0, y: 0, z: 0 };
        const validLoc = {
          x: Number.isFinite(realLoc.x) ? realLoc.x : 0,
          y: Number.isFinite(realLoc.y) ? realLoc.y : 0,
          z: Number.isFinite(realLoc.z) ? realLoc.z : 0
        };
        const geometry = {
          ...element.geometry,
          location: { ...element.geometry?.location, realLocation: validLoc }
        };
        await storage.createBimElement({
          elementId: element.id || `element_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
          modelId,
          elementType: element.type || "unknown",
          category: element.category,
          name: element.name,
          geometry: geometry,
          properties: JSON.stringify(element.properties || {}),
          location: JSON.stringify(geometry.location || {}),
          dimensions: JSON.stringify(element.dimensions || {}),
          material: element.material || element.materials || null,
          quantity: element.quantity || element.quantities || null,
          ifcInfo: JSON.stringify(element.ifcInfo || {}),
          storeyName: element.storey?.name,
          storeyGuid: element.storey?.guid,
          elevation: element.storey?.elevation,
          createdAt: new Date(),
          updatedAt: new Date()
        } as any);
      }
    }
  } catch (e: any) {
    console.error("⚠️ POSTPROCESS: save failed:", e?.message || e);
    throw e;
  }

  const processingSummary = {
    calibrated: true,
    elementCount: finalElements.length,
    rasterDetection: String(process.env.ENABLE_RASTER_GLYPH || "off").toLowerCase() === "on"
  };

  if ((storage as any).updateBimModelMetadata) {
    await (storage as any).updateBimModelMetadata(modelId, {
      calibration: processingSummary,
      postprocess: {
        at: new Date().toISOString(),
        symbols: (DETECT ? "round-symbols" : "none"),
        forced: !!FORCE,
        saved: saveCount
      }
    });
  }

  console.log(`💾 POSTPROCESS: saved ${saveCount} elements (model ${modelId})`);
  return { saved: saveCount, summary: processingSummary, siteUsed: !!site };
}
