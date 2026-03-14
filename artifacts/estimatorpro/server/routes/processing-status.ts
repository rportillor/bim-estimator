import { Router } from "express";
import { backgroundProcessor } from "../services/background-processor";
import { storage } from "../storage";

export const processingStatusRouter = Router();

// Get current processing status for a model
processingStatusRouter.get("/api/bim/models/:modelId/processing-status", async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Check if this model is currently being processed
    const currentStatus = backgroundProcessor.getStatus();
    
    if (currentStatus && currentStatus.modelId === modelId) {
      // Currently processing
      res.json({
        status: 'processing',
        batchIndex: currentStatus.batchIndex,
        totalBatches: currentStatus.totalBatches,
        progress: Math.round((currentStatus.batchIndex / currentStatus.totalBatches) * 100),
        message: `Processing batch ${currentStatus.batchIndex}/${currentStatus.totalBatches}`,
        isActive: true
      });
    } else {
      // Check model status from database
      const model = await storage.getBimModel(modelId);
      const geoData = model?.geometryData as any;
      
      if (geoData?.processingState) {
        const state = geoData.processingState;
        
        // DEBUG: Log what we're actually reading
        console.log('🔍 Progress endpoint reading:', {
          hasProgress: 'progress' in state,
          progressValue: state.progress,
          batchIndex: state.batchIndex,
          totalBatches: state.totalBatches,
          calculated: state.totalBatches > 0 ? Math.round((state.batchIndex / state.totalBatches) * 100) : 0
        });
        
        res.json({
          status: state.status,
          batchIndex: state.batchIndex,
          totalBatches: state.totalBatches,
          progress: state.status === 'completed' ? 100 : (state.progress ?? (state.totalBatches > 0 ? Math.round((state.batchIndex / state.totalBatches) * 100) : 0)),
          message: state.status === 'completed' ? 'Processing complete!' : `Last processed batch ${state.batchIndex}/${state.totalBatches}`,
          lastSavedAt: state.lastSavedAt,
          isActive: false
        });
      } else if (model?.status === 'completed') {
        res.json({
          status: 'completed',
          progress: 100,
          message: 'Model generation complete',
          isActive: false
        });
      } else {
        res.json({
          status: 'pending',
          progress: 0,
          message: 'Processing not started',
          isActive: false
        });
      }
    }
  } catch (error) {
    console.error('Error getting processing status:', error);
    res.status(500).json({
      error: 'Failed to get processing status'
    });
  }
});

// Resume processing for a model
processingStatusRouter.post("/api/bim/models/:modelId/resume-processing", async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Check if already processing
    if (backgroundProcessor.isProcessing()) {
      const currentStatus = backgroundProcessor.getStatus();
      if (currentStatus?.modelId === modelId) {
        return res.json({
          ok: false,
          message: 'Already processing this model'
        });
      } else {
        return res.json({
          ok: false,
          message: `Currently processing another model: ${currentStatus?.modelId}`
        });
      }
    }
    
    // Get model to find project ID
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({
        ok: false,
        message: 'Model not found'
      });
    }
    
    // Start/resume processing
    await backgroundProcessor.startProcessing(model.projectId, modelId);
    
    res.json({
      ok: true,
      message: 'Processing resumed successfully'
    });
  } catch (error) {
    console.error('Error resuming processing:', error);
    res.status(500).json({
      ok: false,
      message: 'Failed to resume processing'
    });
  }
});

// Stop processing for a model
processingStatusRouter.post("/api/bim/models/:modelId/stop-processing", async (req, res) => {
  try {
    const { modelId } = req.params;
    
    const currentStatus = backgroundProcessor.getStatus();
    if (currentStatus?.modelId === modelId) {
      backgroundProcessor.stopProcessing();
      res.json({
        ok: true,
        message: 'Processing stopped'
      });
    } else {
      res.json({
        ok: false,
        message: 'This model is not currently being processed'
      });
    }
  } catch (error) {
    console.error('Error stopping processing:', error);
    res.status(500).json({
      ok: false,
      message: 'Failed to stop processing'
    });
  }
});