// server/routes/estimates-ciqs.ts
import { Router } from "express";
import { buildEstimateForModel } from "../estimator/estimate-engine";

export const estimatesCIQSRouter = Router();

// Canonical CIQS/AACE endpoint (GET)
estimatesCIQSRouter.get("/estimates/ciqs/:modelId", async (req, res) => {
  try {
    const r = await buildEstimateForModel(req.params.modelId);
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "estimate error" });
  }
});