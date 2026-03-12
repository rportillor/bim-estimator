import type { Express } from "express";
import multer from "multer";
import { RfiService } from "../services/rfi-service";
import { authenticateToken } from "../auth";
import { z } from "zod";
import { insertRfiSchema, insertRfiResponseSchema, insertRfiAttachmentSchema } from "@shared/schema";

// D-3 FIX: Added authenticateToken to all 10 handlers.
// Removed all 5 hardcoded UUID fallbacks ('d53a36b4-c36b-49a2-847d-95c33b09fa0f').
// req.user?.id is used directly; unauthenticated callers are rejected by
// authenticateToken before reaching any handler body.

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg", "image/png", "image/gif",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    cb(null, allowed.includes(file.mimetype) ? true : (new Error("Invalid file type") as any));
  },
});

export function registerRfiRoutes(app: Express) {

  // Get RFIs for a project
  app.get("/api/projects/:projectId/rfis", authenticateToken, async (req, res) => {
    try {
      const rfis = await RfiService.getProjectRfis(req.params.projectId);
      res.json(rfis);
    } catch (error) {
      console.error("Error fetching RFIs:", error);
      res.status(500).json({ error: "Failed to fetch RFIs" });
    }
  });

  // Create new RFI
  app.post("/api/projects/:projectId/rfis", authenticateToken, async (req, res) => {
    try {
      const { projectId } = req.params;
      const userId = (req as any).user?.id ?? null;

      const rfiData = insertRfiSchema.parse({
        ...req.body,
        projectId,
        submittedBy: userId,
      });

      const newRfi = await RfiService.createRfi(rfiData);
      res.status(201).json({ success: true, rfi: newRfi });
    } catch (error: any) {
      console.error("Error creating RFI:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create RFI" });
      }
    }
  });

  // Get RFI details with responses and attachments
  app.get("/api/projects/:projectId/rfis/:rfiId", authenticateToken, async (req, res) => {
    try {
      const rfiDetails = await RfiService.getRfiWithDetails(req.params.rfiId);
      res.json(rfiDetails);
    } catch (error: any) {
      console.error("Error fetching RFI details:", error);
      if (error.message === "RFI not found") {
        res.status(404).json({ error: "RFI not found" });
      } else {
        res.status(500).json({ error: "Failed to fetch RFI details" });
      }
    }
  });

  // Add response to RFI
  app.post("/api/projects/:projectId/rfis/:rfiId/responses", authenticateToken, async (req, res) => {
    try {
      const { rfiId } = req.params;
      const userId = (req as any).user?.id ?? null;

      const responseData = insertRfiResponseSchema.parse({
        ...req.body,
        rfiId,
        responderId: userId,
        responderName: req.body.responderName ?? (req as any).user?.name ?? "Unknown User",
      });

      const newResponse = await RfiService.addResponse(responseData);
      res.status(201).json({ success: true, response: newResponse });
    } catch (error: any) {
      console.error("Error adding RFI response:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to add response" });
      }
    }
  });

  // Upload attachment to RFI
  app.post(
    "/api/projects/:projectId/rfis/:rfiId/attachments",
    authenticateToken,
    upload.single("file"),
    async (req, res) => {
      try {
        const { projectId, rfiId } = req.params;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const { FileStorageService } = await import("../services/file-storage");
        const { storagePath, fileHash } = await FileStorageService.saveFile(
          req.file,
          projectId,
          `rfi_${rfiId}`
        );

        const attachmentData = insertRfiAttachmentSchema.parse({
          rfiId,
          fileName: req.file.filename || req.file.originalname,
          originalName: req.file.originalname,
          filePath: storagePath,
          fileMime: req.file.mimetype,
          fileSize: req.file.size,
          fileHash,
          uploadedBy: (req as any).user?.id ?? null,
          description: req.body.description ?? null,
        });

        const newAttachment = await RfiService.addAttachment(attachmentData);
        res.status(201).json({ success: true, attachment: newAttachment });
      } catch (error) {
        console.error("Error uploading RFI attachment:", error);
        res.status(500).json({ error: "Failed to upload attachment" });
      }
    }
  );

  // Update RFI status
  app.patch("/api/projects/:projectId/rfis/:rfiId/status", authenticateToken, async (req, res) => {
    try {
      const { rfiId } = req.params;
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required" });

      const userId: string | undefined = (req as any).user?.id ?? undefined;
      const updatedRfi = await RfiService.updateRfiStatus(rfiId, status, userId);
      res.json({ success: true, rfi: updatedRfi });
    } catch (error) {
      console.error("Error updating RFI status:", error);
      res.status(500).json({ error: "Failed to update RFI status" });
    }
  });

  // Get RFI statistics for project dashboard
  app.get("/api/projects/:projectId/rfis/stats", authenticateToken, async (req, res) => {
    try {
      const stats = await RfiService.getRfiStats(req.params.projectId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching RFI stats:", error);
      res.status(500).json({ error: "Failed to fetch RFI statistics" });
    }
  });

  // Search RFIs
  app.get("/api/projects/:projectId/rfis/search", authenticateToken, async (req, res) => {
    try {
      const { projectId } = req.params;
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query is required" });
      }
      const results = await RfiService.searchRfis(projectId, q);
      res.json(results);
    } catch (error) {
      console.error("Error searching RFIs:", error);
      res.status(500).json({ error: "Failed to search RFIs" });
    }
  });

  // AI-Enhanced: Generate RFI from document conflicts
  app.post(
    "/api/projects/:projectId/rfis/generate-from-conflict",
    authenticateToken,
    async (req, res) => {
      try {
        const { projectId } = req.params;
        const { conflictData } = req.body;
        if (!conflictData) return res.status(400).json({ error: "Conflict data is required" });

        const userId = (req as any).user?.id ?? null;
        const generatedRfi = await RfiService.generateRfiFromConflict(projectId, conflictData, userId);
        res.status(201).json({
          success: true,
          rfi: generatedRfi,
          message: "RFI generated from document conflict",
        });
      } catch (error) {
        console.error("Error generating RFI from conflict:", error);
        res.status(500).json({ error: "Failed to generate RFI from conflict" });
      }
    }
  );

  // Get conflict-generated RFIs
  app.get("/api/projects/:projectId/rfis/ai-generated", authenticateToken, async (req, res) => {
    try {
      const aiRfis = await RfiService.getConflictGeneratedRfis(req.params.projectId);
      res.json(aiRfis);
    } catch (error) {
      console.error("Error fetching AI-generated RFIs:", error);
      res.status(500).json({ error: "Failed to fetch AI-generated RFIs" });
    }
  });
}
