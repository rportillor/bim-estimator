// server/routes/raster-debug.ts
import { Router } from "express";
import { detectRasterSymbolsForModel } from "../services/raster-glyph-locator";

export const rasterDebugRouter = Router();

rasterDebugRouter.get("/bim/models/:modelId/debug/raster-hits", async (req, res) => {
  try {
    const hits = await detectRasterSymbolsForModel(req.params.modelId);
    res.json({ ok:true, count: hits.length, hits: hits.slice(0,200) });
  } catch (e:any) {
    res.status(500).json({ ok:false, message: e?.message || "raster debug error" });
  }
});