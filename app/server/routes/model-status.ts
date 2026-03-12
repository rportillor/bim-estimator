// server/routes/model-status.ts
import { Router } from "express";
import { storage } from "../storage";
import { coerceStatus, updateModelStatus } from "../services/model-status";

export const bimModelStatusRouter = Router();

/** GET current status/progress for a model */
bimModelStatusRouter.get("/bim/models/:modelId/status", async (req, res) => {
  try {
    const model = await (storage as any).getBimModel?.(req.params.modelId);
    if (!model) return res.status(404).json({ error: "Model not found" });

    // Prefer top-level fields, fall back to metadata
    const meta = model.metadata || {};
    res.json({
      id: model.id,
      status: model.status || meta.status || "queued",
      progress: typeof model.progress === "number" ? model.progress : (meta.progress ?? 0),
      message: model.lastMessage || meta.lastMessage || null,
      error: model.lastError || meta.lastError || null,
      updatedAt: model.updatedAt || meta._updatedAt || null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to read status" });
  }
});

/** PATCH status/progress for a model */
bimModelStatusRouter.patch("/bim/models/:modelId/status", async (req, res) => {
  try {
    const { status, progress, message, error, meta } = req.body || {};
    const patch = {
      status: status ? coerceStatus(status) : undefined,
      progress: (typeof progress === "number" && progress >= 0 && progress <= 1) ? progress : undefined,
      message: (typeof message === "string") ? message : undefined,
      error: (typeof error === "string") ? error : undefined,
      meta: (meta && typeof meta === "object") ? meta : undefined,
    };
    await updateModelStatus(storage, req.params.modelId, patch);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to update status" });
  }
});