// server/routes/bim-generate.ts  — v15.13
// Primary BIM generation route.
//
// Architecture:
//   POST /api/bim/models/:modelId/generate
//     → resolves model + project
//     → delegates entirely to BIMGenerator.generateBIMModel()
//       (which handles: PDF text extract, Claude analysis, QTO, calibrate, upsert)
//     → fetches element count from DB and returns
//
// BIMGenerator.generateBIMModel() returns Promise<BimModel> (DB record).
// It does NOT return elements[] in the JS return value — elements are written
// to the bimElements table internally.  The previous route checked
// bimResult.elements which is always undefined on a BimModel, so it always
// 500-errored.  Fixed: fetch element count from DB after generation.

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { publish } from "../services/progress-bus";

const logger = {
  info:  (msg: string, d?: any) => console.log(`✅ [BIM-ROUTE] ${msg}`, d || ''),
  warn:  (msg: string, d?: any) => console.warn(`⚠️  [BIM-ROUTE] ${msg}`, d || ''),
  error: (msg: string, d?: any) => console.error(`❌ [BIM-ROUTE] ${msg}`, d || ''),
};

export const bimGenerateRouter = Router();

// ─── Clear stuck lock ────────────────────────────────────────────────────────
bimGenerateRouter.delete("/bim/clear-lock", async (req: Request, res: Response) => {
  try {
    const { ExtractionLockManager } = await import("../extraction-lock-manager");
    const before = await ExtractionLockManager.getLockStatus();
    await ExtractionLockManager.isLocked(); // triggers stale-lock cleanup
    const after  = await ExtractionLockManager.getLockStatus();
    res.json({ ok: true, previousLock: before, currentStatus: after });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: `Failed to clear lock: ${e.message}` });
  }
});

// ─── Lock status ─────────────────────────────────────────────────────────────
bimGenerateRouter.get("/bim/lock-status", async (_req: Request, res: Response) => {
  try {
    const { ExtractionLockManager } = await import("../extraction-lock-manager");
    res.json({ ok: true, lockStatus: await ExtractionLockManager.getLockStatus() });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ─── Main generation endpoint ─────────────────────────────────────────────────
//
// Body params:
//   projectId?        — required when modelId is not a valid project model ID
//   positioningMode?  — "auto" | "forcePerimeter" | "preferClaude"  (default: env / "auto")
//   lod?              — "standard" | "detailed" | "max"              (default: "detailed")
//   levelOfDetail?    — alias for lod (e.g. "LOD300" maps to getLodProfile fallback)
//   includeStructural / includeMEP / includeArchitectural / qualityLevel — passed through
//
// The route MUST NOT create a BimModel record itself.
// BIMGenerator.generateBIMModel() owns model lifecycle (find existing / create new / dedup).
//
bimGenerateRouter.post("/bim/models/:modelId/generate", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const {
    projectId,
    positioningMode,
    lod,
    levelOfDetail,
    includeStructural    = true,
    includeMEP           = true,
    includeArchitectural = true,
    qualityLevel         = 'professional',
  } = (req.body || {});

  // Resolve project ID: body.projectId → look up from existing model → fallback to modelId param
  let pid = typeof projectId === 'string' && projectId ? projectId : null;
  if (!pid) {
    try {
      const existing = await storage.getBimModel(modelId);
      if (existing?.projectId) pid = existing.projectId;
    } catch { /* model may not exist yet */ }
  }
  if (!pid) pid = modelId; // last resort: caller passed a projectId as modelId

  // Verify project exists
  const project = await storage.getProject(pid).catch(() => null);
  if (!project) {
    return res.status(422).json({
      ok: false,
      message: `Project not found (id: ${pid}). Pass body.projectId with a valid project UUID.`,
    });
  }

  // Verify documents exist
  const docs = await storage.getDocumentsByProject(pid);
  if (!docs.length) {
    return res.status(422).json({
      ok: false,
      message: 'No documents linked to this project. Upload drawings / specifications first.',
    });
  }

  // Check lock
  const { ExtractionLockManager } = await import("../extraction-lock-manager");
  if (await ExtractionLockManager.isLocked()) {
    return res.status(409).json({
      ok: false,
      message: 'Another extraction is already in progress. Wait for it to complete or DELETE /api/bim/clear-lock.',
    });
  }
  const processId = `api-generate-${Date.now()}`;
  if (!await ExtractionLockManager.acquireLock(processId)) {
    return res.status(409).json({ ok: false, message: 'Could not acquire lock. Retry shortly.' });
  }

  try {
    // Resolve LOD: accept both "lod" (profile name) and "levelOfDetail" (LOD200/LOD300/etc.)
    // getLodProfile already falls back to "detailed" for unknown keys.
    const lodResolved: string = lod || levelOfDetail || process.env.DEFAULT_LOD || 'detailed';

    logger.info(`Starting BIM generation`, { pid, modelId, lod: lodResolved, docs: docs.length });

    const { BIMGenerator } = await import("../bim-generator");
    const generator = new BIMGenerator();

    // BIMGenerator.generateBIMModel handles:
    //   • model find-or-create + dedup
    //   • PDF text extract (all docs)
    //   • Claude analysis (cached or fresh)
    //   • Real QTO processing (batch by type)
    //   • calibrateAndPositionElements
    //   • postprocessAndSaveBIM (calibration + raster detection)
    //   • upsertBimElements → bimElements table
    //   • upsertBimStoreys  → bimStoreys  table
    //   • model status → "completed"
    const bimModel = await generator.generateBIMModel(
      pid,
      docs,
      {
        lod: lodResolved,
        levelOfDetail: lodResolved,
        units: 'metric',
        includeStructural,
        includeMEP,
        includeArchitectural,
        qualityLevel,
        coordinateSystem: 'global',
        positioningMode: positioningMode || process.env.POSITIONING_MODE || 'auto',
      } as any,
    );

    // Fetch element count from DB — generateBIMModel returns BimModel (no elements[] property)
    const elements = await storage.getBimElements(bimModel.id);

    logger.info(`Generation complete`, { modelId: bimModel.id, elementCount: elements.length });

    // Auto-trigger 3D geometry build to create real mesh data from generated elements
    let build3DStats: any = null;
    try {
      const { buildModel } = await import('../bim/model-builder');
      const { exportBIMToIFC4 } = await import('../bim/ifc-export-v2');
      const { serializeBIMSolid } = await import('../bim/parametric-elements');

      const rawElements: any[] = elements.map((e: any) => {
        const geometry = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry || {};
        const properties = typeof e.properties === 'string' ? JSON.parse(e.properties) : e.properties || {};
        const dims = geometry.dimensions || properties.dimensions || {};
        const loc = geometry.location?.realLocation || properties.realLocation || {};
        return {
          id: e.id || e.elementId,
          type: e.elementType || 'Generic',
          name: e.name || e.elementType,
          category: e.category,
          storey: e.storeyName || e.level || 'Level 1',
          elevation: Number(e.elevation) || 0,
          length: Number(dims.length || dims.width) || undefined,
          width: Number(dims.width || dims.thickness) || undefined,
          height: Number(dims.height) || undefined,
          thickness: Number(dims.thickness || dims.depth) || undefined,
          depth: Number(dims.depth) || undefined,
          x: Number(loc.x) || 0,
          y: Number(loc.y) || 0,
          z: Number(loc.z) || 0,
          startX: properties.start?.x,
          startY: properties.start?.y,
          endX: properties.end?.x,
          endY: properties.end?.y,
          material: e.material || properties.material,
          sectionDesignation: properties.sectionDesignation || properties.profileName || properties.steelSection || properties.memberSize,
          source: 'ai_modeled',
          properties,
        };
      });

      const storeys = await storage.getBimStoreys?.(bimModel.id) || [];
      const context: any = {
        name: project.name || 'Project',
        storeys: storeys.length > 0
          ? storeys.map((s: any) => ({ name: s.name, elevation: Number(s.elevation) || 0, floorToFloorHeight: Number(s.floorToFloorHeight) || 3.0 }))
          : [{ name: 'Level 1', elevation: 0, floorToFloorHeight: 3.0 }],
      };

      const buildResult = buildModel(rawElements, context, { runClashCheck: true, generateIFC: true, ifcOptions: { projectName: project.name } });

      // Store IFC data on model
      if (buildResult.ifcContent) {
        await storage.updateBimModel(bimModel.id, {
          ifcData: buildResult.ifcContent,
          geometryData: JSON.stringify({ version: '2.0', engine: 'proie-geometry-kernel', elementCount: buildResult.elements.length }),
        });
      }

      // Update elements with real mesh geometry
      for (const el of buildResult.elements) {
        const serialized = serializeBIMSolid(el);
        try {
          await storage.updateBimElement?.(el.id, {
            geometry: JSON.stringify({
              dimensions: { length: el.quantities.length, width: el.quantities.width, height: el.quantities.height, depth: el.quantities.thickness, area: el.quantities.surfaceArea, volume: el.quantities.volume },
              location: { realLocation: el.origin },
              mesh: serialized,
              boundingBox: el.boundingBox,
            }),
            properties: JSON.stringify({
              material: el.material,
              assembly: el.assembly?.name,
              ifcClass: el.ifcClass,
              source: el.source,
              hostId: el.hostId,
              quantities: el.quantities,
            }),
          });
        } catch { /* non-fatal */ }
      }

      build3DStats = buildResult.stats;
      logger.info(`3D geometry built`, { modelId: bimModel.id, withGeometry: buildResult.stats.withGeometry, clashes: buildResult.clashSummary.total });
    } catch (build3DError: any) {
      logger.error('Auto 3D build failed (non-fatal)', { message: build3DError?.message });
    }

    return res.json({
      ok: true,
      modelId: bimModel.id,
      projectId: pid,
      elementCount: elements.length,
      status: bimModel.status,
      message: `BIM model generated: ${elements.length} elements saved to database.`,
      lod: lodResolved,
      build3D: build3DStats,
    });

  } catch (err: any) {
    logger.error('Generation failed', { message: err?.message });
    return res.status(500).json({ ok: false, message: err?.message || 'Generation failed unexpectedly' });
  } finally {
    await ExtractionLockManager.releaseLock(processId);
  }
});

// ─── Re-extract elements only (skip batch product/assembly phase) ─────────────
//
// POST /api/bim/models/:modelId/extract-elements
//
// Use when the model has 0 elements but products/assemblies already exist
// (e.g. after fixing the beta-header bug in analyzePDFForBuildingGeometry).
// Skips the 30+ min batch phase — only runs the PDF coordinate extraction
// and postprocessing steps.  Takes ~5-10 min.
//
bimGenerateRouter.post("/bim/models/:modelId/extract-elements", async (req: Request, res: Response) => {
  const { modelId } = req.params;

  // Resolve model and project
  const model = await storage.getBimModel(modelId).catch(() => null);
  if (!model) {
    return res.status(404).json({ ok: false, message: `BIM model ${modelId} not found.` });
  }
  const pid = (model as any).projectId;
  const project = await storage.getProject(pid).catch(() => null);
  if (!project) {
    return res.status(422).json({ ok: false, message: `Project ${pid} not found.` });
  }

  const docs = await storage.getDocumentsByProject(pid);
  if (!docs.length) {
    return res.status(422).json({ ok: false, message: 'No documents found for this project.' });
  }

  // Check lock
  const { ExtractionLockManager } = await import("../extraction-lock-manager");
  if (await ExtractionLockManager.isLocked()) {
    return res.status(409).json({ ok: false, message: 'Another extraction is in progress. Try again shortly.' });
  }
  const processId = `api-extract-${Date.now()}`;
  if (!await ExtractionLockManager.acquireLock(processId)) {
    return res.status(409).json({ ok: false, message: 'Could not acquire lock. Retry shortly.' });
  }

  try {
    logger.info(`Starting element re-extraction`, { modelId, pid, docs: docs.length });

    // Mark model as processing
    await storage.updateBimModel(modelId, { status: 'processing' as any });

    // Recover stored Claude analysis from the model's geometry/metadata
    const geoData = (() => {
      try {
        const raw = (model as any).geometryData;
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
      } catch { return {}; }
    })();
    const storedAnalysis = geoData.aiAnalysis || geoData.analysisStrategy || null;

    // Pick the primary document (first PDF/DWG/DXF/IFC)
    const primaryDoc = docs.find(d => /\.(pdf|dwg|dxf|ifc)$/i.test((d as any).filename || (d as any).originalName || '')) || docs[0];
    const primaryStorageKey = (primaryDoc as any).storageKey || (primaryDoc as any).filename || '';
    // Use filename as the path hint — processRealBIMData uses loadFileBuffer internally via storageKey
    const primaryPath = primaryStorageKey;

    // Collect ALL PDF storageKeys so analyzePDFForBuildingGeometry can send every drawing
    // to Claude in a single call (Claude API allows up to 20 documents per message).
    const allPdfStorageKeys: string[] = docs
      .filter(d => /\.pdf$/i.test((d as any).filename || (d as any).originalName || ''))
      .map(d => (d as any).storageKey || (d as any).filename || '')
      .filter(Boolean);
    logger.info(`Collected ${allPdfStorageKeys.length} PDF documents for multi-document analysis`);

    // Run only the RealQTO element-extraction step (no batch product/assembly phase)
    const { RealQTOProcessor } = await import('../real-qto-processor');
    const qto = new RealQTOProcessor();

    const qtoResult = await qto.processRealBIMData(
      pid,
      primaryPath,
      {
        unitSystem: 'metric',
        includeStoreys: true,
        computeGeometry: true,
        // Pass storageKey so analyzePDFForBuildingGeometry can call loadFileBuffer
        claudeAnalysis: {
          ...(storedAnalysis || {}),
          storageKey: primaryStorageKey,
        },
        buildingAnalysis: storedAnalysis?.building_analysis,
        modelId,
        projectId: pid,
        useAllDocuments: true,
        documentCount: docs.length,
        allDocumentStorageKeys: allPdfStorageKeys,
      } as any,
    );

    const elements: any[] = Array.isArray((qtoResult as any)?.elements)
      ? (qtoResult as any).elements
      : [];

    logger.info(`QTO extracted ${elements.length} elements — running postprocess`, { modelId });

    // Run postprocessing (calibration + relationship analysis + upsert)
    const { postprocessAndSaveBIM } = await import('../services/bim-postprocess');
    await postprocessAndSaveBIM({
      modelId,
      projectId: pid,
      elements,
      forceCalibrate: true,
    });

    // Final element count from DB — write it back to the model row so the frontend
    // can gate on model.elementCount > 0 (viewer-3d.tsx, bim.tsx lines 79/399/478/482).
    const saved = await storage.getBimElements(modelId);
    await storage.updateBimModel(modelId, { status: 'completed' as any, elementCount: saved.length } as any);

    logger.info(`Re-extraction complete`, { modelId, elementCount: saved.length });

    return res.json({
      ok: true,
      modelId,
      elementCount: saved.length,
      message: `Element re-extraction complete: ${saved.length} elements saved.`,
    });

  } catch (err: any) {
    logger.error('Element re-extraction failed', { message: err?.message });
    await storage.updateBimModel(modelId, { status: 'completed' as any }).catch(() => {});
    return res.status(500).json({ ok: false, message: err?.message || 'Re-extraction failed unexpectedly' });
  } finally {
    await ExtractionLockManager.releaseLock(processId);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bim/models/:modelId/extract-layer
//
// Layer-by-layer BIM extraction — the proper way to build a model:
//   1. gridlines          (structural grid system — the skeleton)
//   2. perimeter_walls    (exterior envelope / foundation walls)
//   3. interior_walls     (partitions)
//   4. columns            (structural columns)
//   5. slabs              (floor + ceiling slabs)
//   6. doors
//   7. windows
//   8. stairs
//   9. mep
//
// Each layer is cached after the first Claude call — subsequent calls are FREE.
// Elements are appended to the model (existing layers for OTHER types are kept).
//
// Body:
//   floor          — "P1" | "Ground" | "Floor2" | "Floor3" | "MPH" | "Roof"
//   layer          — one of the 9 layer names above
//   elevation?     — override floor elevation (metres, relative to datum)
//   ceilingElevation? — override ceiling elevation (metres)
//   documentKeys?  — override document storage keys (auto-mapped from floor if omitted)
// ─────────────────────────────────────────────────────────────────────────────
bimGenerateRouter.post("/bim/models/:modelId/extract-layer", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { floor: floorName, layer, elevation, ceilingElevation, documentKeys } = req.body as {
    floor: string;
    layer: string;
    elevation?: number;
    ceilingElevation?: number;
    documentKeys?: string[];
  };

  if (!floorName || !layer) {
    return res.status(400).json({ ok: false, message: 'Body must include "floor" and "layer".' });
  }

  const model = await storage.getBimModel(modelId).catch(() => null);
  if (!model) return res.status(404).json({ ok: false, message: `BIM model ${modelId} not found.` });
  const pid = (model as any).projectId;

  try {
    const { RealQTOProcessor } = await import('../real-qto-processor');
    const qto = new RealQTOProcessor();

    // Resolve floor elevations — body overrides win; then static map; then defaults
    const staticFloor = RealQTOProcessor.FLOOR_ELEVATIONS[floorName];
    const floorDef = {
      name: floorName,
      elevation:        elevation        ?? staticFloor?.elevation ?? 0,
      ceilingElevation: ceilingElevation ?? staticFloor?.ceiling   ?? 4,
    };

    // Resolve document storage keys — body overrides; otherwise auto-map from floor
    let resolvedKeys: string[] = documentKeys ?? [];
    if (resolvedKeys.length === 0) {
      const patterns = RealQTOProcessor.FLOOR_DOC_PATTERNS[floorName] ?? [];
      if (patterns.length === 0) {
        return res.status(400).json({ ok: false, message: `No document mapping found for floor "${floorName}". Provide documentKeys.` });
      }
      const allDocs = await storage.getDocumentsByProject(pid);
      resolvedKeys = allDocs
        .filter((d: any) => {
          const fn: string = (d.filename || d.storageKey || '').toUpperCase();
          return patterns.some(p => fn.includes(p.toUpperCase()));
        })
        .map((d: any) => d.storageKey || d.filename || '')
        .filter(Boolean);
      logger.info(`[extract-layer] Auto-mapped ${resolvedKeys.length} docs for ${floorName}: ${resolvedKeys.map((k: string) => k.split('_').pop()).join(', ')}`);
    }

    if (resolvedKeys.length === 0) {
      return res.status(422).json({ ok: false, message: `No documents found for floor "${floorName}". Upload drawings first.` });
    }

    // Run the layer extraction (uses cache, then Claude, then saves cache)
    const newElements = await qto.extractLayer({
      modelId, projectId: pid,
      floor: floorDef,
      layer,
      documentStorageKeys: resolvedKeys,
    });

    logger.info(`[extract-layer] Extracted ${newElements.length} elements for ${floorName}/${layer}`);

    // Delete existing elements of this type+storey before saving new ones
    const layerTypes = RealQTOProcessor.LAYER_ELEMENT_TYPES[layer] ?? [];
    const existing = await storage.getBimElements(modelId);
    const toDelete = existing.filter((e: any) =>
      layerTypes.includes(e.elementType) &&
      (e.storeyName === floorName || !e.storeyName)
    );
    for (const el of toDelete) {
      await storage.deleteBimElement(el.id).catch(() => {});
    }
    logger.info(`[extract-layer] Deleted ${toDelete.length} stale ${floorName}/${layer} elements`);

    // Insert new elements
    for (const el of newElements) {
      const elId = (el as any).id || `${floorName}_${layer}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await storage.createBimElement({
        modelId,
        elementId: elId,
        elementType: (el as any).elementType,
        name: (el as any).name,
        storeyName: floorName,
        geometry: (el as any).geometry,
        properties: (el as any).properties,
        quantity: (el as any).quantity,
        unit: (el as any).unit,
        ifcClass: null,
        guid: null,
        parentId: null,
        level: null,
        material: null,
      } as any);
    }

    // Update model element count
    const allAfter = await storage.getBimElements(modelId);
    await storage.updateBimModel(modelId, { elementCount: allAfter.length } as any);

    return res.json({
      ok: true,
      modelId,
      floor: floorName,
      layer,
      extracted: newElements.length,
      deleted: toDelete.length,
      totalElements: allAfter.length,
      message: `${floorName}/${layer}: extracted ${newElements.length} elements (deleted ${toDelete.length} stale).`,
    });

  } catch (err: any) {
    logger.error(`[extract-layer] Failed: ${err?.message}`);
    return res.status(500).json({ ok: false, message: err?.message || 'Layer extraction failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bim/models/:modelId/build-model
//
// Fully automated layer-by-layer BIM model build.
// Iterates every floor × every layer in the canonical order, calls
// extract-layer logic for each combination, publishes SSE progress events
// that the client SSE hook can display live.
//
// Caching is handled inside extractLayer — if a floor+layer combo was already
// extracted and its documents haven't changed, Claude is NOT called again.
// This means re-running a completed build is nearly instant.
//
// Document selection rules:
//   gridlines layer → plan-only drawings (FLOOR_PLAN_PATTERNS)
//   all other layers → full drawing set  (FLOOR_DOC_PATTERNS)
//
// Body (all optional):
//   floors        — array of floor names to process (default: all 6)
//   layers        — array of layer names to process (default: all 9)
//   forceRefresh  — if true, bypass the Claude cache for all layers
// ─────────────────────────────────────────────────────────────────────────────
bimGenerateRouter.post("/bim/models/:modelId/build-model", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const {
    floors: requestedFloors,
    layers: requestedLayers,
    forceRefresh = false,
  } = req.body as {
    floors?: string[];
    layers?: string[];
    forceRefresh?: boolean;
  };

  const model = await storage.getBimModel(modelId).catch(() => null);
  if (!model) return res.status(404).json({ ok: false, message: `BIM model ${modelId} not found.` });
  const pid = (model as any).projectId;

  const { RealQTOProcessor } = await import('../real-qto-processor');

  // Resolve the floor and layer lists to process
  const floors = (requestedFloors && requestedFloors.length > 0)
    ? requestedFloors
    : RealQTOProcessor.FLOOR_ORDER;
  const layers = (requestedLayers && requestedLayers.length > 0)
    ? requestedLayers
    : RealQTOProcessor.LAYER_ORDER;

  const totalSteps = floors.length * layers.length;
  const buildStartedAt = new Date().toISOString();

  logger.info(`[build-model] Starting — ${floors.length} floors × ${layers.length} layers = ${totalSteps} steps`);

  // Acknowledge immediately — the real work runs asynchronously
  res.json({
    ok: true,
    running: true,
    floors,
    layers,
    totalSteps,
    message: `Build pipeline started: ${totalSteps} floor/layer combinations queued.`,
  });

  // ── Background pipeline ──────────────────────────────────────────────────
  (async () => {
    let step = 0;
    let totalExtracted = 0;
    let totalDeleted = 0;

    // Mark model as 'generating' so the UI can detect it survived a page refresh
    await storage.updateBimModel(modelId, { status: 'generating' as any });
    await (storage as any).updateBimModelMetadata?.(modelId, {
      buildPhase:      'running',
      buildStep:       0,
      buildTotalSteps: totalSteps,
      buildFloors:     floors,
      buildLayers:     layers,
      buildStartedAt,
      buildCurrentFloor: floors[0] ?? '',
      buildCurrentLayer: '',
      buildPct:        0,
      progress:        0,
      message:         'Build pipeline started…',
    });

    try {
      const allDocs = await storage.getDocumentsByProject(pid);
      const qto = new RealQTOProcessor();

      // ── Pre-build cleanup ──────────────────────────────────────────────────
      // Remove all elements that:
      //   (a) belong to floors we are NOT building, OR
      //   (b) have no storeyName (stale legacy records with no floor tag).
      // This prevents old extraction runs from polluting the viewer.
      const floorsSet = new Set(floors);
      const allExisting = await storage.getBimElements(modelId);
      const outOfScope = allExisting.filter((e: any) =>
        !e.storeyName || !floorsSet.has(e.storeyName)
      );
      if (outOfScope.length > 0) {
        logger.info(`[build-model] Pre-build: deleting ${outOfScope.length} elements from out-of-scope floors`);
        for (const el of outOfScope) {
          await storage.deleteBimElement(el.id).catch(() => {});
        }
        totalDeleted += outOfScope.length;
      }

      for (const floorName of floors) {
        const staticFloor = RealQTOProcessor.FLOOR_ELEVATIONS[floorName];
        if (!staticFloor) {
          logger.warn(`[build-model] Unknown floor "${floorName}" — skipping`);
          step += layers.length;
          continue;
        }
        const floorDef = {
          name: floorName,
          elevation: staticFloor.elevation,
          ceilingElevation: staticFloor.ceiling,
        };

        for (const layer of layers) {
          step++;
          const pct = Math.round((step / totalSteps) * 98); // cap at 98 — 100 reserved for done

          const layerMsg = `${floorName} / ${layer.replace(/_/g, ' ')} (${step}/${totalSteps})…`;

          // Persist progress to DB so page refreshes can restore it
          await (storage as any).updateBimModelMetadata?.(modelId, {
            buildPhase:        'running',
            buildStep:         step,
            buildTotalSteps:   totalSteps,
            buildCurrentFloor: floorName,
            buildCurrentLayer: layer,
            buildPct:          pct,
            progress:          pct / 100,
            message:           layerMsg,
          });

          // Publish start-of-layer progress via SSE
          publish(modelId, {
            pct,
            phase: 'running',
            message: layerMsg,
            floor: floorName,
            layer,
            step,
            totalSteps,
          });

          try {
            // Smart document selection: gridlines → plan drawings only
            const patterns = layer === 'gridlines'
              ? (RealQTOProcessor.FLOOR_PLAN_PATTERNS[floorName] ?? [])
              : (RealQTOProcessor.FLOOR_DOC_PATTERNS[floorName] ?? []);

            const resolvedKeys = allDocs
              .filter((d: any) => {
                const fn: string = (d.filename || d.storageKey || '').toUpperCase();
                return patterns.some((p: string) => fn.includes(p.toUpperCase()));
              })
              .map((d: any) => d.storageKey || d.filename || '')
              .filter(Boolean);

            if (resolvedKeys.length === 0) {
              logger.warn(`[build-model] No docs for ${floorName}/${layer} — skipping`);
              publish(modelId, {
                pct,
                phase: 'running',
                message: `${floorName} / ${layer} — no documents found, skipped`,
                floor: floorName,
                layer,
                step,
                totalSteps,
              });
              continue;
            }

            // Run extraction (cache-first: no Claude call if result is cached)
            const newElements = await qto.extractLayer({
              modelId,
              projectId: pid,
              floor: floorDef,
              layer,
              documentStorageKeys: resolvedKeys,
              forceRefresh,
            });

            // Delete stale elements for this floor+layer
            const layerTypes = RealQTOProcessor.LAYER_ELEMENT_TYPES[layer] ?? [];
            const existing = await storage.getBimElements(modelId);
            const toDelete = existing.filter((e: any) =>
              layerTypes.includes(e.elementType) &&
              (e.storeyName === floorName || !e.storeyName)
            );
            for (const el of toDelete) {
              await storage.deleteBimElement(el.id).catch(() => {});
            }

            // Insert new elements
            for (const el of newElements) {
              const elId = (el as any).id ||
                `${floorName}_${layer}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              await storage.createBimElement({
                modelId,
                elementId: elId,
                elementType: (el as any).elementType,
                name: (el as any).name,
                storeyName: floorName,
                geometry: (el as any).geometry,
                properties: (el as any).properties,
                quantity: (el as any).quantity,
                unit: (el as any).unit,
                ifcClass: null,
                guid: null,
                parentId: null,
                level: null,
                material: null,
              } as any);
            }

            totalExtracted += newElements.length;
            totalDeleted += toDelete.length;

            logger.info(`[build-model] ${floorName}/${layer}: +${newElements.length} extracted, -${toDelete.length} stale`);

            // Update element count after each layer
            const allAfter = await storage.getBimElements(modelId);
            await storage.updateBimModel(modelId, { elementCount: allAfter.length } as any);

            // Publish post-layer progress with element counts
            publish(modelId, {
              pct,
              phase: 'running',
              message: `${floorName} / ${layer} ✓ — ${newElements.length} elements (${step}/${totalSteps} done)`,
              floor: floorName,
              layer,
              step,
              totalSteps,
              extracted: newElements.length,
              totalElements: allAfter.length,
            });

          } catch (layerErr: any) {
            logger.error(`[build-model] ${floorName}/${layer} failed: ${layerErr?.message}`);
            publish(modelId, {
              pct,
              phase: 'running',
              message: `${floorName} / ${layer} — error: ${layerErr?.message || 'unknown'} (continuing…)`,
              floor: floorName,
              layer,
              step,
              totalSteps,
              layerError: layerErr?.message,
            });
            // Non-fatal: continue with next layer
          }
        }
      }

      // All done — persist completion state and restore model status
      const finalCount = (await storage.getBimElements(modelId)).length;
      const doneMsg = `Build complete — ${finalCount} elements across ${floors.length} floor(s)`;
      logger.info(`[build-model] Complete — ${totalExtracted} extracted, ${totalDeleted} deleted, ${finalCount} total elements`);

      await storage.updateBimModel(modelId, { status: 'completed' as any, elementCount: finalCount });
      await (storage as any).updateBimModelMetadata?.(modelId, {
        buildPhase:      'complete',
        buildStep:       totalSteps,
        buildTotalSteps: totalSteps,
        buildPct:        100,
        progress:        1,
        message:         doneMsg,
        buildCompletedAt: new Date().toISOString(),
        buildTotalExtracted: totalExtracted,
        buildTotalElements:  finalCount,
      });

      publish(modelId, {
        pct: 100,
        phase: 'complete',
        message: doneMsg,
        totalExtracted,
        totalDeleted,
        totalElements: finalCount,
      });

    } catch (err: any) {
      const errMsg = `Build pipeline failed: ${err?.message || 'unknown error'}`;
      logger.error(`[build-model] Pipeline failed: ${err?.message}`);

      await storage.updateBimModel(modelId, { status: 'failed' as any });
      await (storage as any).updateBimModelMetadata?.(modelId, {
        buildPhase: 'error',
        buildError: err?.message || 'unknown',
        message:    errMsg,
        progress:   0,
      });

      publish(modelId, {
        pct: 0,
        phase: 'error',
        message: errMsg,
      });
    }
  })().catch(() => {}); // swallow unhandled promise rejection — errors are published above
});
