/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  IFC EXPORT ROUTE — Wired to IFC4 Export Engine
 *  GET /api/bim/models/:id/export/ifc      → Download IFC file
 *  GET /api/bim/models/:id/export/ifc/stats → Export statistics
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { Router } from "express";
import { storage } from "../storage";
import {
  generateIFC4Document,
  getIFCExportStats,
} from "../services/ifc-export-engine";
import type { IFCBIMElement } from "../services/ifc-export-engine";

export const ifcExportRouter = Router();

/**
 * Download IFC4 STEP file
 * Query params:
 *   ?units=metric|imperial  (default: metric)
 *   ?quantities=true|false  (default: true)
 *   ?properties=true|false  (default: true)
 *   ?materials=true|false   (default: true)
 */
ifcExportRouter.get("/bim/models/:id/export/ifc", async (req, res) => {
  try {
    const { id } = req.params;
    const unitSystem =
      (req.query.units as string) === "imperial" ? "imperial" : "metric";

    const model = await (storage as any).getBimModel?.(id);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }

    const rawElements =
      (await (storage as any).getBimElements?.(id)) || [];

    // Map to IFCBIMElement interface
    const elements: IFCBIMElement[] = rawElements.map((e: any) => ({
      id: e.id,
      elementType: e.elementType || e.type,
      type: e.type,
      name: e.properties?.name || e.elementType || e.type,
      storey: e.storey || e.properties?.storey,
      storeyIndex: e.storeyIndex,
      properties: e.properties,
      geometry: e.geometry,
      material: e.material || e.properties?.material,
      csiDivision: e.csiDivision || e.properties?.csiDivision,
    }));

    if (elements.length === 0) {
      return res
        .status(400)
        .json({ error: "No BIM elements found for model" });
    }

    const ifcContent = generateIFC4Document(elements, {
      projectName: model.projectName || model.name || "EstimatorPro Export",
      projectId: id,
      description: model.description || "BIM Model Export",
      author: "EstimatorPro v3",
      organization: "CIQS Professional",
      unitSystem,
      includeQuantities: req.query.quantities !== "false",
      includeProperties: req.query.properties !== "false",
      includeMaterials: req.query.materials !== "false",
    });

    const stats = getIFCExportStats(elements);

    res.setHeader("Content-Type", "application/x-step");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="model-${id}.ifc"`
    );
    res.setHeader("X-IFC-Element-Count", String(stats.totalElements));
    res.setHeader("X-IFC-Entity-Count", String(stats.entityCount));
    res.setHeader("X-IFC-Schema", "IFC4");
    res.send(ifcContent);
  } catch (e: any) {
    console.error("[IFC Export]", e);
    res.status(500).json({ error: e?.message || "IFC export error" });
  }
});

/**
 * Get export statistics without downloading
 */
ifcExportRouter.get("/bim/models/:id/export/ifc/stats", async (req, res) => {
  try {
    const { id } = req.params;
    const rawElements =
      (await (storage as any).getBimElements?.(id)) || [];

    const elements: IFCBIMElement[] = rawElements.map((e: any) => ({
      id: e.id,
      elementType: e.elementType || e.type,
      type: e.type,
      storey: e.storey || e.properties?.storey,
      properties: e.properties,
      geometry: e.geometry,
      material: e.material || e.properties?.material,
      csiDivision: e.csiDivision,
    }));

    res.json(getIFCExportStats(elements));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "IFC stats error" });
  }
});
