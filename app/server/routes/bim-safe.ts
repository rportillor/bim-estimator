// server/routes/bim-safe.ts  — v15.13
// Safe BIM operations with enhanced error handling.
// generate endpoint now delegates to BIM facade (which delegates to BIMGenerator).

import { Router } from "express";
import { enhancedAuth } from "../middleware/auth-fix";
import { asyncHandler, BimError } from "../middleware/error-handler";
import { safeDeleteModel, bulkDeleteModels } from "../services/cascade-delete";
import { publishProgress } from "./progress";
import { validate } from "../middleware/validate";
import { z } from "zod";

export const bimSafeRouter = Router();

const ModelIdSchema = z.object({
  modelId: z.string().uuid("Invalid model ID format"),
});

const BulkDeleteSchema = z.object({
  modelIds: z
    .array(z.string().uuid())
    .min(1, "At least one model ID required")
    .max(50, "Maximum 50 models per batch"),
});

// ─── Safe model deletion ──────────────────────────────────────────────────────
bimSafeRouter.delete(
  "/bim/models/:modelId",
  enhancedAuth,
  validate({ params: ModelIdSchema }),
  asyncHandler(async (req: any, res: any) => {
    const { modelId } = req.params;
    publishProgress(modelId, { progress: 0, phase: "delete", message: "Starting model deletion…" });
    const result = await safeDeleteModel(modelId);
    publishProgress(modelId, { progress: 100, phase: "complete", message: `Deleted ${result.elementsDeleted} elements` });
    res.json({ success: true, message: "Model deleted successfully", elementsDeleted: result.elementsDeleted });
  }),
);

// ─── Bulk model cleanup ───────────────────────────────────────────────────────
bimSafeRouter.post(
  "/bim/models/bulk-delete",
  enhancedAuth,
  validate({ body: BulkDeleteSchema }),
  asyncHandler(async (req: any, res: any) => {
    const { modelIds } = req.body;
    if (modelIds.length > 10) {
      throw new BimError("Batch size too large", 400, "BATCH_TOO_LARGE", {
        requested: modelIds.length,
        maximum: 10,
      });
    }
    const result = await bulkDeleteModels(modelIds);
    res.json({
      success: true,
      message: `Deleted ${result.deleted} models with ${result.elementsDeleted} elements`,
      modelsDeleted: result.deleted,
      elementsDeleted: result.elementsDeleted,
    });
  }),
);

// ─── Enhanced generation — delegates to BIM facade ───────────────────────────
// Previously called bim-facade which returned [] placeholder.
// Now wired through BIM.assemble() → BIMGenerator.generateBIMModel().
bimSafeRouter.post(
  "/bim/models/:modelId/generate",
  enhancedAuth,
  validate({ params: ModelIdSchema }),
  asyncHandler(async (req: any, res: any) => {
    const { modelId } = req.params;
    const options = req.body || {};

    if (!options.projectId) {
      throw new BimError("Project ID required", 400, "MISSING_PROJECT_ID");
    }

    publishProgress(modelId, { progress: 0, phase: "init", message: "Initialising BIM generation…" });

    const { BIM } = await import("../services/bim-facade");

    const elements = await BIM.assemble({
      projectId: options.projectId,
      modelId,
      unitSystem: options.unitSystem || "metric",
      analysis: options.analysis,
      buildingLayout: options.buildingLayout,
      gridSystem: options.gridSystem,
      lod: options.lod || options.levelOfDetail || "detailed",
    });

    publishProgress(modelId, { progress: 100, phase: "complete", message: "BIM generation completed" });

    res.json({
      success: true,
      message: "BIM generation completed",
      elementsGenerated: elements.length,
      modelId,
    });
  }),
);
