// server/routes/raster-overlay.ts
import { Router } from "express";
import { storage } from "../storage";
import { detectRasterSymbolsForModel } from "../services/raster-glyph-locator";
import { mapPagePointToModel } from "../helpers/site-symbols";

export const rasterOverlayRouter = Router();

/** GET /api/bim/models/:modelId/debug/raster-overlay
 * Returns mapped model-space points for raster glyph hits.
 * Shape: { ok, count, hits: [{ type, x, y, z, score }] }
 */
rasterOverlayRouter.get("/bim/models/:modelId/debug/raster-overlay", async (req, res) => {
  try {
    const { modelId } = req.params;

    // 1) Derive a calibrated bbox from existing element positions if available
    let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
    let defaultZ = 0;
    let storeyElevations: number[] = [];

    let elements: any[] = [];
    try {
      if (typeof (storage as any).getBimElements === "function") {
        elements = await (storage as any).getBimElements(modelId);
      }
    } catch { /* elements not available */ }

    for (const e of elements) {
      const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : e?.geometry;
      const p = g?.location?.realLocation;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (Number.isFinite(p.z)) defaultZ = p.z;
      }
      const s = e?.storey?.elevation ?? e?.storey?.Elevation ?? null;
      if (Number.isFinite(s)) storeyElevations.push(Number(s));
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      // fallback bbox if nothing is calibrated yet
      minX = -10; minY = -10; maxX = 10; maxY = 10;
    }
    if (!storeyElevations.length) storeyElevations = [0];

    // 2) Get raster hits in page space
    const hits = await detectRasterSymbolsForModel(modelId);

    // 3) Map to model space using bbox
    const mapped = hits.map(h => {
      const pos = mapPagePointToModel(h.x, h.y, h.pageWidth, h.pageHeight, { minX, minY, maxX, maxY });
      // choose an elevation: put lights/sprinklers near ceiling; receptacles near floor
      const zLift =
        h.type === "LIGHT_FIXTURE" ? 2.8 :
        h.type === "SPRINKLER"     ? 2.6 :
        h.type === "RECEPTACLE"    ? 0.3 :
        1.0;
      const zBase = storeyElevations[0] ?? defaultZ ?? 0;
      return {
        type: h.type,
        x: pos.x, y: pos.y, z: zBase + zLift,
        score: h.score
      };
    });

    res.json({ ok: true, count: mapped.length, hits: mapped });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "overlay error" });
  }
});