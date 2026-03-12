// server/routes/bim-debug.ts
import { Router } from "express";
import { storage } from "../storage";

export const bimDebugRouter = Router();

bimDebugRouter.get("/bim/models/:modelId/debug/summary", async (req, res) => {
  try {
    const { modelId } = req.params;
    const all = await storage.getBimElements(modelId);
    const n = all.length;

    const byType: Record<string, number> = {};
    let originCount = 0;
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity, maxH=0;

    const topBig: any[] = [];
    for (const e of all) {
      const t = String(e?.elementType || "UNKNOWN").toUpperCase();
      byType[t] = (byType[t] || 0) + 1;

      // Parse JSON geometry data
      const geometry = typeof e.geometry === 'string' ? JSON.parse(e.geometry) : e.geometry;
      const p = geometry?.location?.realLocation || { x: 0, y: 0, z: 0 };
      if ((+p.x || 0) === 0 && (+p.y || 0) === 0) originCount++;

      const d = geometry?.dimensions || {};
      const w = +d.width || 0, h = +d.height || 0, dpt = +d.depth || 0;
      if (w*h*dpt > 1000) { // suspiciously huge
        if (topBig.length < 10) topBig.push({ id: e.id, type: t, w, h, d: dpt, p });
      }

      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      if (Number.isFinite(h) && h > maxH) maxH = h;
    }

    res.json({
      count: n,
      byType,
      percentAtOrigin: n ? +(originCount * 100 / n).toFixed(1) : 0,
      bbox: { minX, minY, maxX, maxY, width: maxX - minX, length: maxY - minY, maxHeight: maxH },
      topHuge: topBig
    });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || "debug error" });
  }
});