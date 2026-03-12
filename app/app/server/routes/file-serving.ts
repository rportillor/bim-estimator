import express from "express";
import path from "path";
import fs from "fs";
import { authenticateToken } from "../auth";
import { storage } from "../storage";

const router = express.Router();

/**
 * Secure IFC file serving endpoint for 3D viewer
 * Validates user has access to the project before serving files
 */
router.get("/secure-ifc/:projectId/:filename", authenticateToken, async (req, res) => {
  try {
    const { projectId, filename } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Verify user has access to this project
    const project = await storage.getProject(projectId);
    if (!project || project.userId !== userId) {
      return res.status(403).json({ error: "Access denied to this project" });
    }

    // Construct safe file path
    const storageDir = process.env.LOCAL_STORAGE_DIR || "./uploads";
    const safePath = path.join(storageDir, "projects", projectId, "ifc", filename);
    
    // Validate file exists and is within allowed directory
    const normalizedPath = path.normalize(safePath);
    const allowedDir = path.normalize(path.join(storageDir, "projects", projectId));
    
    if (!normalizedPath.startsWith(allowedDir)) {
      return res.status(400).json({ error: "Invalid file path" });
    }

    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({ error: "IFC file not found" });
    }

    // Set appropriate headers for IFC files
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // 1 hour cache
    
    // Stream the file
    const fileStream = fs.createReadStream(normalizedPath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error("Error serving IFC file:", error);
    res.status(500).json({ error: "Failed to serve IFC file" });
  }
});

/**
 * Get signed URL for IFC file (compatibility endpoint for viewer)
 * Returns local URL that the viewer can use to access IFC files
 */
router.get("/signed-ifc", authenticateToken, async (req, res) => {
  try {
    const { key } = req.query; // Expected format: "projects/projectId/ifc/filename.ifc"
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: "Missing or invalid key parameter" });
    }

    // Extract projectId and filename from key
    const keyParts = key.split('/');
    if (keyParts.length < 4 || keyParts[0] !== 'projects' || keyParts[2] !== 'ifc') {
      return res.status(400).json({ error: "Invalid key format. Expected: projects/projectId/ifc/filename.ifc" });
    }

    const projectId = keyParts[1];
    const filename = keyParts[3];

    // Generate local URL for secure file access
    const baseUrl = req.protocol + '://' + req.get('host');
    const secureUrl = `${baseUrl}/api/secure-ifc/${projectId}/${filename}`;

    res.json({ url: secureUrl });
    
  } catch (error) {
    console.error("Error generating signed URL:", error);
    res.status(500).json({ error: "Failed to generate signed URL" });
  }
});

export default router;