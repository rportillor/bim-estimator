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
