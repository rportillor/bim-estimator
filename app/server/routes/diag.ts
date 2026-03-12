import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { storage } from "../storage";

export const diagRouter = Router();

// SECURITY: All diag endpoints are gated to development mode only
function devOnly(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: "Not found" });
  }
  next();
}

diagRouter.use(devOnly);

function envFlag(name: string) {
  return process.env[name] ? "SET" : "missing";
}

diagRouter.get("/__routes", (req,res)=>{
  const app: any = req.app;
  const out: any[] = [];
  app?._router?.stack?.forEach((layer: any) => {
    if (layer.route) {
      out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods) });
    } else if (layer.name === "router" && layer.handle?.stack) {
      layer.handle.stack.forEach((l: any) => {
        if (l.route) out.push({ path: l.route.path, methods: Object.keys(l.route.methods) });
      });
    }
  });
  res.json(out);
});

diagRouter.get("/__diag", async (req,res)=>{
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const tsconfig = fs.existsSync("tsconfig.json") ? JSON.parse(fs.readFileSync("tsconfig.json","utf8")) : {};
    const env = {
      DEFAULT_LOD: envFlag("DEFAULT_LOD"),
      FORCE_ENHANCED_PIPELINE: envFlag("FORCE_ENHANCED_PIPELINE"),
      CALIBRATE_FORCE: envFlag("CALIBRATE_FORCE"),
      POSTPROCESS_ON_SERVE: envFlag("POSTPROCESS_ON_SERVE"),
      SITE_SYMBOL_DETECT: envFlag("SITE_SYMBOL_DETECT"),
      ANTHROPIC_API_KEY: envFlag("ANTHROPIC_API_KEY"),
      LOD_LIGHT_SPACING: envFlag("LOD_LIGHT_SPACING"),
      LOD_SPRINKLER_SPACING: envFlag("LOD_SPRINKLER_SPACING"),
      LOD_RECEPTACLE_SPACING: envFlag("LOD_RECEPTACLE_SPACING"),
      DATABASE_URL: envFlag("DATABASE_URL"),
      PGHOST: envFlag("PGHOST"),
    };

    const dbInfo: any = {};
    try {
      const getCounts = (storage as any).debugCounts?.bind(storage);
      if (getCounts) Object.assign(dbInfo, await getCounts());
    } catch {}

    res.json({
      node: process.version,
      pkg: { name: pkg.name, ver: pkg.version },
      ts: tsconfig?.compilerOptions || {},
      env,
      dbInfo
    });
  } catch (e:any) {
    res.status(500).json({ message: e?.message || "diag failed" });
  }
});

diagRouter.get("/bim/models/:modelId/debug/summary", async (req, res) => {
  try {
    const { modelId } = req.params;
    const all = await storage.getBimElements(modelId);
    const n = all.length;
    const byType: Record<string, number> = {};
    let originCount = 0;
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity, maxH=0;

    for (const e of all) {
      const t = String(e?.elementType || (e as any)?.type || (e as any)?.category || "UNKNOWN").toUpperCase();
      byType[t] = (byType[t] || 0) + 1;
      const g = typeof e.geometry === "string" ? JSON.parse(e.geometry) : e.geometry;
      const p = g?.location?.realLocation || { x: 0, y: 0, z: 0 };
      if ((+p.x || 0) === 0 && (+p.y || 0) === 0) originCount++;
      const d = g?.dimensions || {};
      const h = +d.height || 0;
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
      bbox: { minX, minY, maxX, maxY, width: maxX - minX, length: maxY - minY, maxHeight: maxH }
    });
  } catch (e:any) { res.status(500).json({ message: e?.message || "debug error" }); }
});
