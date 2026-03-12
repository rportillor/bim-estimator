import { Router } from "express";
import { storage } from "../storage";
import { postprocessAndSaveBIM } from "../services/bim-postprocess";

export const postprocessRouter = Router();

postprocessRouter.post("/bim/models/:modelId/recalibrate", async (req, res) => {
  try {
    const { modelId } = req.params;
    const model = await storage.getBimModel(modelId);
    const elems = await storage.getBimElements(modelId);
    const projectId = model?.projectId || "unknown";

    const { calibrateAndPositionElements } = await import("../helpers/layout-calibration");

    const updated = await calibrateAndPositionElements(projectId, modelId, elems, {
      mode: "forcePerimeter",
      reCenterToOrigin: true,
      flipZIfAllYNegative: true,
      clampOutliersMeters: process.env.CALIB_CLAMP_M ? Number(process.env.CALIB_CLAMP_M) : undefined
    });

    // ✅ PERFORMANCE FIX: Use efficient batch upsert instead of individual operations
    await storage.upsertBimElements(modelId, updated.map(elem => ({
      id: elem.elementId || elem.id || `elem-${Date.now()}`,
      elementId: elem.elementId || elem.id || `elem-${Date.now()}`,
      type: elem.type || elem.elementType || 'UNKNOWN',
      name: elem.name || 'Element',
      geometry: elem.geometry || {},
      properties: elem.properties || {},
      materials: elem.materials || [],
      quantities: elem.quantities || {},
      storey: elem.storey || {},
      category: elem.category || 'Other'
    })));

    // Performance improvement completed - batch operations significantly faster

    res.json({ ok: true, count: updated.length });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "recalibrate failed" });
  }
});

postprocessRouter.post("/bim/models/:modelId/reprocess", async (req, res) => {
  try {
    const { modelId } = req.params;
    const model = await storage.getBimModel(modelId);
    const elems = await storage.getBimElements(modelId);
    const storeys: any[] = [];

    console.log("🔧 [REPROCESS] Starting balanced calibration for existing model...");
    
    // Apply the full balanced assembly + calibration pipeline
    const { balancedAssemble } = await import("../services/balanced-assembler");
    const { calibrateAndPositionElements } = await import("../helpers/layout-calibration");
    const { sanitizeElements } = await import("../helpers/element-sanitizer");

    // 1) Sanitize existing elements
    const { elements: cleaned } = sanitizeElements(elems);
    console.log(`🧹 [REPROCESS] Sanitized ${cleaned.length} elements`);

    // 2) Apply balanced assembly (seeding + LOD expansion)
    const assembled = await balancedAssemble({
      baseElements: cleaned,
      analysis: {},
      storeys,
      options: {
        lod: process.env.DEFAULT_LOD,
        minStructuralFraction: process.env.LOD_MIN_STRUCT_FRAC ? Number(process.env.LOD_MIN_STRUCT_FRAC) : undefined,
        targetArchitecturalFraction: process.env.LOD_TARG_ARCH_FRAC ? Number(process.env.LOD_TARG_ARCH_FRAC) : undefined,
        maxGridFraction: process.env.LOD_MAX_GRID_FRAC ? Number(process.env.LOD_MAX_GRID_FRAC) : undefined
      }
    });
    console.log(`🧩 [REPROCESS] Balanced assembly: ${assembled.elements.length} elements`);

    // 3) Apply calibration
    const finalElements = await calibrateAndPositionElements(
      model?.projectId || modelId,
      modelId,
      assembled.elements || assembled,
      {
        mode: "forcePerimeter",
        reCenterToOrigin: true,
        flipZIfAllYNegative: true,
        clampOutliersMeters: 500
      }
    );
    console.log(`🔧 [REPROCESS] Calibrated ${finalElements.length} positioned elements`);

    // 4) Save the reprocessed elements
    for (const elem of finalElements) {
      await storage.createBimElement({
        modelId,
        elementId: elem.elementId || elem.id || `elem-${Date.now()}`,
        elementType: elem.type || elem.elementType || 'UNKNOWN',
        name: elem.name || 'Element',
        geometry: JSON.stringify(elem.geometry || {}),
        properties: JSON.stringify(elem.properties || {}),
        material: JSON.stringify(elem.materials || []),
        quantity: JSON.stringify(elem.quantities || {}),
        location: JSON.stringify({ ...elem.location, storey: elem.storey }),
        category: elem.category || 'Other'
      });
    }

    res.json({ 
      ok: true, 
      count: finalElements.length,
      reprocessed: true,
      balanced: true,
      calibrated: true 
    });
  } catch (e: any) {
    console.error("❌ [REPROCESS] Failed:", e);
    res.status(500).json({ ok: false, message: e?.message || "reprocess failed" });
  }
});