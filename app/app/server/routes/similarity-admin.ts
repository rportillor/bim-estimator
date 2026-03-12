import { Router } from "express";
import { evictByAge, evictToCap, evictProjectToCap } from "../services/similarity-evict";

export const similarityAdminRouter = Router();

similarityAdminRouter.post("/admin/similarity/evict", async (req, res) => {
  try {
    const maxAgeDays = Number(req.body?.maxAgeDays ?? process.env.SIM_EVICT_MAX_AGE_DAYS ?? 90);
    const maxRows    = Number(req.body?.maxRows    ?? process.env.SIM_EVICT_MAX_ROWS     ?? 100_000);

    const deletedByAge = maxAgeDays > 0 ? await evictByAge(maxAgeDays) : 0;
    const deletedByCap = maxRows > 0 ? await evictToCap(maxRows) : 0;

    res.json({ ok: true, deletedByAge, deletedByCap, maxAgeDays, maxRows });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "Eviction failed" });
  }
});

// NEW: per-project cap eviction
similarityAdminRouter.post("/admin/similarity/evict/project", async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || "");
    const maxPairs = Number(req.body?.maxPairs ?? process.env.SIM_EVICT_PROJECT_MAX_PAIRS ?? 5000);
    const mode = (String(req.body?.mode || process.env.SIM_EVICT_PROJECT_MODE || "score").toLowerCase() === "recent")
      ? "recent" : "score";

    if (!projectId) return res.status(400).json({ ok: false, message: "projectId required" });

    const outcome = await evictProjectToCap(projectId, maxPairs, mode);
    res.json({ ok: true, ...outcome, mode });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "Per-project eviction failed" });
  }
});