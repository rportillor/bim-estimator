import { Router } from "express";
import { storage } from "../storage";
import { getBus } from "../services/progress-bus";

export const progressSseRouter = Router();

/** GET /api/bim/models/:modelId/progress/stream */
progressSseRouter.get("/bim/models/:modelId/progress/stream", async (req, res) => {
  try {
    const { modelId } = req.params;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send current status immediately
    try {
      const model = await (storage as any).getBimModel?.(modelId);
      if (model) {
        const meta = model.metadata || {};
        send({
          ts: Date.now(),
          status: model.status || meta.status || "queued",
          progress: typeof model.progress === "number" ? model.progress : (meta.progress ?? 0),
          message: model.lastMessage || meta.lastMessage || null,
          error: model.lastError || meta.lastError || null,
        });
      }
    } catch { /* model not found */ }

    const bus = getBus(modelId);
    const onTick = (payload: any) => send(payload);
    bus.on("tick", onTick);

    // Keep-alive heartbeat every 15s so proxies don't kill the stream
    const ka = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);

    req.on("close", () => { clearInterval(ka); bus.off("tick", onTick); res.end(); });
  } catch (_e:any) {
    res.status(500).end();
  }
});