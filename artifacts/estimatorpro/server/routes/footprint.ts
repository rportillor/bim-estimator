// server/routes/footprint.ts
import { Router } from "express";
import { ensureFootprintForModel } from "../services/footprint-extractor";
import { storage as _storage } from "../storage";
import Anthropic from '@anthropic-ai/sdk';

export const footprintRouter = Router();

footprintRouter.post("/bim/models/:modelId/footprint/ensure", async (req, res) => {
  try {
    const { modelId } = req.params;
    const { projectId } = req.body || {};
    if (!projectId) return res.status(400).json({ message: "projectId required" });

    // Try to reuse the anthropic client loaded in the generator, if available
    let anthropic: any = (req as any).anthropic || (global as any).anthropic;
    try {
      // Create anthropic client if not available
      if (!anthropic) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          anthropic = new Anthropic({ apiKey });
        }
      }
    } catch { /* anthropic client not available */ }

    const out = await ensureFootprintForModel({ modelId, projectId, anthropicClient: anthropic });
    res.json({ ok: true, ...out });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "failed to ensure footprint" });
  }
});