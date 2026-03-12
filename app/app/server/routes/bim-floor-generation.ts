// server/routes/bim-floor-generation.ts
// 🏗️ Floor-by-floor BIM generation route

import { Router } from "express";
import { authenticateToken } from "../auth";
import { storage } from "../storage";
import { logger } from "../utils/enterprise-logger";
import { 
  groupDocumentsByFloor, 
  analyzeFloorDocuments, 
  generateFloorBIM, 
  combineFloorModels 
} from "../helpers/floor-analyzer";

export const floorBimRouter = Router();

/**
 * Generate BIM model using floor-by-floor approach
 * POST /api/projects/:projectId/bim-models/generate-by-floor
 */
// Architecture law: floor-by-floor bypasses specs→products→assemblies pipeline.
// Return 410 so callers are directed to the correct endpoint.
floorBimRouter.post('/projects/:projectId/bim-models/generate-by-floor', authenticateToken, (_req, res) => {
  res.status(410).json({
    error: 'Floor-by-floor BIM generation is disabled.',
    reason: 'This path bypasses the construction methodology pipeline (specs→products→assemblies→elements).',
    useInstead: 'POST /api/bim/models/:modelId/generate',
  });
});

floorBimRouter.get('/projects/:projectId/floor-analysis', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    // Verify project ownership  
    const project = await storage.getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // DEVELOPMENT MODE: Allow test user to access any project
    if (process.env.NODE_ENV === 'development' && userId === 'test-user-id') {
      // Test user can access any project in development
    } else if (project.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get documents and group by floor
    const documents = await storage.getDocumentsByProject(projectId);
    const floorGroups = await groupDocumentsByFloor(documents, projectId);

    res.json({
      totalDocuments: documents.length,
      floors: floorGroups.map(group => ({
        name: group.floorName,
        level: group.level,
        documentCount: group.documents.length,
        documents: group.documents.map(doc => ({
          id: doc.id,
          filename: doc.originalName
        }))
      }))
    });

  } catch (error) {
    logger.error(`Floor analysis failed`, {
      projectId: req.params.projectId,
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(500).json({
      error: "Floor analysis failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});