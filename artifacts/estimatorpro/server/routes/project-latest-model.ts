import { Router } from "express";
import { storage } from "../storage";

export const projectLatestModelRouter = Router();

/**
 * GET /api/projects/:projectId/latest-model
 * Always returns the most recent BIM model for a project
 */
projectLatestModelRouter.get("/projects/:projectId/latest-model", async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get all models sorted by most recent
    const models = await storage.getBimModels(projectId);
    
    if (!models || models.length === 0) {
      return res.status(404).json({
        message: "No BIM models found for this project. Generate one first."
      });
    }
    
    // Return the most recent model
    const latestModel = models[0];
    
    // Get element count for the latest model
    const elements = await storage.getBimElements(latestModel.id);
    
    res.json({
      model: latestModel,
      elementCount: elements.length,
      isLatest: true,
      generatedAt: latestModel.createdAt,
      status: latestModel.status
    });
  } catch (error: any) {
    console.error("Error fetching latest model:", error);
    res.status(500).json({
      error: "Failed to fetch latest model"
    });
  }
});

/**
 * DELETE /api/projects/:projectId/old-models
 * Clean up old models, keeping only the most recent one
 */
projectLatestModelRouter.delete("/projects/:projectId/old-models", async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get all models sorted by most recent
    const models = await storage.getBimModels(projectId);
    
    if (models.length <= 1) {
      return res.json({
        message: "No old models to clean up",
        kept: models.length,
        deleted: 0
      });
    }
    
    // Keep only the most recent model
    const toDelete = models.slice(1);
    let deletedCount = 0;
    
    for (const model of toDelete) {
      try {
        // Delete associated elements first
        const elements = await storage.getBimElements(model.id);
        for (const elem of elements) {
          await storage.deleteBimElement(elem.id);
        }
        // Then delete the model
        await storage.deleteBimModel(model.id);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete model ${model.id}:`, error);
      }
    }
    
    res.json({
      message: `Cleaned up ${deletedCount} old models`,
      kept: 1,
      deleted: deletedCount,
      latestModel: models[0].id
    });
  } catch (error: any) {
    console.error("Error cleaning old models:", error);
    res.status(500).json({
      error: "Failed to clean old models"
    });
  }
});