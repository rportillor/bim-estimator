// server/routes/drawing-debug.ts
import { Router } from "express";
import { storage } from "../storage";
import { analyzeDrawingsForFacts } from "../services/drawing-analyzer";

export const drawingDebugRouter = Router();

drawingDebugRouter.get("/bim/models/:modelId/debug/drawing-facts", async (req, res) => {
  try {
    const modelId = req.params.modelId;
    const model = await storage.getBimModel(modelId);
    const docs = await storage.getDocumentsByProject(model?.projectId || "");
    const { enabled, facts } = await analyzeDrawingsForFacts(model?.projectId || "", docs || []);
    res.json({ ok:true, enabled, facts });
  } catch (e:any) {
    res.status(500).json({ ok:false, message: e?.message || "drawing facts error" });
  }
});