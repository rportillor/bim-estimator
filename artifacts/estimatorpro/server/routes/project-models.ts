import { Router } from "express";
import { storage } from "../storage";

export const projectModelsRouter = Router();

function devBypassOn() {
  return String(process.env.DEV_AUTH_BYPASS || "off").toLowerCase() === "on";
}

function extractToken(req: any): string | null {
  const h = req.headers?.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const c = req.headers?.cookie || "";
  const m = c.match(/(?:^|;\s*)auth_token=([^;]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// NOTE: If you already have `authenticateToken`, replace this with it;
// keep the dev bypass behavior for local/testing.
async function requireAuth(req: any, res: any, next: any) {
  if (devBypassOn()) return next();
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Access token required" });

  // If your app exposes a verifier, call it; else allow token presence in dev.
  try {
    if (typeof (storage as any).verifyAccessToken === "function") {
      const user = await (storage as any).verifyAccessToken(token);
      (req as any).user = user;
      return next();
    }
    // Fallback: token present is enough (production should implement real verify).
    return next();
  } catch (_e:any) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/** GET list of BIM models for a project (auth required unless DEV_AUTH_BYPASS=on) */
projectModelsRouter.get("/projects/:projectId/bim-models", requireAuth, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Try both common storage shapes
    let models: any[] = [];
    if (typeof (storage as any).getBimModelsByProject === "function") {
      models = await (storage as any).getBimModelsByProject(projectId);
    } else if (typeof (storage as any).getBimModels === "function") {
      models = await (storage as any).getBimModels(projectId);
    } else if (typeof (storage as any).listBimModels === "function") {
      models = await (storage as any).listBimModels(projectId);
    } else {
      return res.status(500).json({ error: "Storage adapter missing getBimModels*()" });
    }

    // Enrich with element counts when possible
    const enriched = await Promise.all(models.map(async (m:any) => {
      let elementCount: number | null = null;

      // Prefer a direct count method
      if (typeof (storage as any).countBimElements === "function") {
        try { elementCount = await (storage as any).countBimElements(m.id); } catch { /* optional */ }
      }

      // Try fetching a few elements to infer (avoid huge query)
      if (elementCount == null && typeof (storage as any).getBimElements === "function") {
        try {
          const some = await (storage as any).getBimElements(m.id);
          elementCount = Array.isArray(some) ? some.length : null;
        } catch { /* optional */ }
      }

      // Fallback to geometryData
      if (elementCount == null) {
        try {
          const gd = typeof m.geometryData === "string" ? JSON.parse(m.geometryData) : m.geometryData;
          elementCount = Array.isArray(gd?.elements) ? gd.elements.length : null;
        } catch { elementCount = null; }
      }

      const meta = m.metadata || {};
      return {
        id: m.id,
        name: m.name || meta.name || `Model ${m.id.slice(0,8)}`,
        status: m.status || meta.status || "completed",
        createdAt: m.createdAt || m.created_at || meta.createdAt || null,
        elementCount,
        metadata: meta,
      };
    }));

    res.json(enriched);
  } catch (e:any) {
    res.status(500).json({ error: e?.message || "Failed to list BIM models" });
  }
});

/** DEV ONLY: unauthenticated list for debugging (guarded by env) */
projectModelsRouter.get("/projects/:projectId/bim-models-debug", async (req, res) => {
  if (!devBypassOn()) return res.status(403).json({ error: "Disabled in production" });
  
  // Direct call to avoid recursion
  try {
    const { projectId } = req.params;
    let models: any[] = [];
    
    if (typeof (storage as any).getBimModels === "function") {
      models = await (storage as any).getBimModels(projectId);
    }
    
    res.json({ 
      debug: true, 
      projectId, 
      modelCount: models.length,
      models: models.map(m => ({ id: m.id, name: m.name, status: m.status }))
    });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || "Debug endpoint failed" });
  }
});