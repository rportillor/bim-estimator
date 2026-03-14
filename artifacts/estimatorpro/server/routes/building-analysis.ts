// server/routes/building-analysis.ts
import { Router, type Request, type Response } from "express";
import { storage } from "../storage";

export const buildingAnalysisRouter = Router();

// Simple test route to verify router works
buildingAnalysisRouter.get("/test-ba", (req: Request, res: Response) => {
  res.json({ message: "Building analysis router is working!" });
});

// POST building footprint dimensions
buildingAnalysisRouter.post("/models/:modelId/footprint", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { dimensions, origin, perimeter } = req.body || {};
  
  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }

    const patch: any = { 
      buildingAnalysis: { dimensions, origin, perimeter },
      updated_at: new Date()
    };
    
    await storage.updateBimModel(modelId, patch);
    res.json({ ok: true, message: "Building footprint stored successfully" });
  } catch (err: any) {
    console.error("Error storing building analysis:", err);
    res.status(500).json({ message: err?.message || "Failed to save analysis" });
  }
});

// GET building footprint dimensions  
buildingAnalysisRouter.get("/models/:modelId/footprint", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  
  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ error: "Model not found" });
    }
    
    res.json((model as any)?.buildingAnalysis || null);
  } catch (err: any) {
    console.error("Error reading building analysis:", err);
    res.status(500).json({ message: err?.message || "Failed to read analysis" });
  }
});