import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import { ChangeRequestService } from "../services/change-request-service";
import { z } from "zod";
import { insertChangeRequestSchema, insertChangeRequestAttachmentSchema } from "@shared/schema";

// WP-R7 FIX: Removed mockAiAnalysis object (estimatedCostImpact: 15000, item1/item2).
// The analyze-impact endpoint now calls Claude directly.
// If ANTHROPIC_API_KEY is absent the endpoint returns 503 — it never writes
// fabricated data to the database.

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    cb(null, allowed.includes(file.mimetype) ? true : (new Error('Invalid file type') as any));
  },
});

export function registerChangeRequestRoutes(app: Express) {

  // Get Change Requests for a project
  app.get("/api/projects/:projectId/change-requests", async (req, res) => {
    try {
      const changeRequests = await ChangeRequestService.getProjectChangeRequests(req.params.projectId);
      res.json(changeRequests);
    } catch (error) {
      console.error("Error fetching Change Requests:", error);
      res.status(500).json({ error: "Failed to fetch Change Requests" });
    }
  });

  // Create new Change Request
  app.post("/api/projects/:projectId/change-requests", async (req, res) => {
    try {
      const { projectId } = req.params;
      const crData = insertChangeRequestSchema.parse({
        ...req.body,
        projectId,
        submittedBy: (req as any).user?.id || null,
      });
      const newCr = await ChangeRequestService.createChangeRequest(crData);
      res.status(201).json({ success: true, changeRequest: newCr });
    } catch (error: any) {
      console.error("Error creating Change Request:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Validation error", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create Change Request" });
      }
    }
  });

  // Get Change Request details with attachments
  app.get("/api/projects/:projectId/change-requests/:crId", async (req, res) => {
    try {
      const crDetails = await ChangeRequestService.getChangeRequestWithDetails(req.params.crId);
      res.json(crDetails);
    } catch (error: any) {
      console.error("Error fetching Change Request details:", error);
      if (error.message === "Change Request not found") {
        res.status(404).json({ error: "Change Request not found" });
      } else {
        res.status(500).json({ error: "Failed to fetch Change Request details" });
      }
    }
  });

  // Upload attachment to Change Request
  app.post("/api/projects/:projectId/change-requests/:crId/attachments", upload.single('file'), async (req, res) => {
    try {
      const { projectId, crId } = req.params;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const { FileStorageService } = await import("../services/file-storage");
      const { storagePath, fileHash } = await FileStorageService.saveFile(req.file, projectId, `change_request_${crId}`);

      const attachmentData = insertChangeRequestAttachmentSchema.parse({
        changeRequestId: crId,
        fileName: req.file.filename || req.file.originalname,
        originalName: req.file.originalname,
        filePath: storagePath,
        fileMime: req.file.mimetype,
        fileSize: req.file.size,
        fileHash,
        uploadedBy: (req as any).user?.id || null,
        description: req.body.description || null,
        attachmentType: req.body.attachmentType || "supporting_document",
      });

      const newAttachment = await ChangeRequestService.addAttachment(attachmentData);
      res.status(201).json({ success: true, attachment: newAttachment });
    } catch (error) {
      console.error("Error uploading Change Request attachment:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  });

  // Update Change Request status
  app.patch("/api/projects/:projectId/change-requests/:crId/status", async (req, res) => {
    try {
      const { crId } = req.params;
      const { status, notes } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required" });

      const userId = (req as any).user?.id || null;
      const updatedCr = await ChangeRequestService.updateStatus(crId, status, userId, notes);
      res.json({ success: true, changeRequest: updatedCr });
    } catch (error) {
      console.error("Error updating Change Request status:", error);
      res.status(500).json({ error: "Failed to update Change Request status" });
    }
  });

  // Get Change Request statistics
  app.get("/api/projects/:projectId/change-requests/stats", async (req, res) => {
    try {
      const stats = await ChangeRequestService.getChangeRequestStats(req.params.projectId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching Change Request stats:", error);
      res.status(500).json({ error: "Failed to fetch Change Request statistics" });
    }
  });

  // Search Change Requests
  app.get("/api/projects/:projectId/change-requests/search", async (req, res) => {
    try {
      const { projectId } = req.params;
      const { q } = req.query;
      if (!q || typeof q !== 'string') return res.status(400).json({ error: "Search query is required" });

      const results = await ChangeRequestService.searchChangeRequests(projectId, q);
      res.json(results);
    } catch (error) {
      console.error("Error searching Change Requests:", error);
      res.status(500).json({ error: "Failed to search Change Requests" });
    }
  });

  // AI-Enhanced: Analyze Change Request impact
  // WP-R7 FIX: Real Claude API call — no mockAiAnalysis, no hardcoded $15,000.
  // Returns 503 if ANTHROPIC_API_KEY is missing rather than writing fabricated data.
  app.post("/api/projects/:projectId/change-requests/:crId/analyze-impact", async (req, res) => {
    try {
      const { projectId, crId } = req.params;

      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({
          error: "AI impact analysis unavailable",
          detail: "ANTHROPIC_API_KEY is not configured. Impact analysis requires a live Claude API connection.",
        });
      }

      // Fetch the change request so Claude has full context
      const crDetails = await ChangeRequestService.getChangeRequestWithDetails(crId);
      if (!crDetails) return res.status(404).json({ error: "Change Request not found" });

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = `You are a Canadian quantity surveyor (MCIQS) performing a change request impact analysis
for the project: ${projectId}.

CHANGE REQUEST DETAILS:
${JSON.stringify(crDetails, null, 2)}

Analyse this change request and return a JSON object with exactly this structure:
{
  "estimatedCostImpact": <number in CAD, positive = cost increase, negative = saving>,
  "estimatedScheduleImpact": <integer days, positive = delay, negative = acceleration>,
  "affectedBoqItems": <array of BOQ item IDs or CSI codes affected>,
  "affectedDocuments": <array of document IDs or drawing numbers affected>,
  "estimateRevisionRequired": <boolean>,
  "bimModelUpdateRequired": <boolean>,
  "riskAssessment": {
    "level": "<low|medium|high|critical>",
    "factors": <array of risk factor strings>
  },
  "recommendations": <array of action item strings>,
  "csiDivisionsAffected": <array of CSI division codes e.g. "03 00 00">,
  "confidenceLevel": "<low|medium|high>",
  "analysisNotes": "<string explaining key assumptions or data gaps>"
}

Base your analysis only on the information provided. If cost data is insufficient, set
estimatedCostImpact to null and note the gap in analysisNotes. Return ONLY valid JSON.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const responseText = response.content[0].type === 'text' ? response.content[0].text : '';

      // Parse JSON from Claude's response
      let analysis: any;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object in Claude response');
        analysis = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.error('Failed to parse Claude impact analysis response:', parseErr);
        return res.status(502).json({
          error: "AI response could not be parsed",
          detail: "Claude returned a response but it was not valid JSON. Please retry.",
        });
      }

      // Validate required fields
      if (typeof analysis.estimatedScheduleImpact !== 'number' &&
          analysis.estimatedCostImpact !== null &&
          typeof analysis.estimatedCostImpact !== 'number') {
        return res.status(502).json({
          error: "AI response missing required fields",
          detail: "Claude response did not contain expected cost/schedule fields.",
        });
      }

      // Persist the real analysis
      const updatedCr = await ChangeRequestService.analyzeImpact(crId, analysis);

      res.json({
        success: true,
        changeRequest: updatedCr,
        analysis,
      });
    } catch (error) {
      console.error("Error analyzing Change Request impact:", error);
      res.status(500).json({ error: "Failed to analyze Change Request impact" });
    }
  });

  // Get Change Requests requiring BoQ updates
  app.get("/api/projects/:projectId/change-requests/boq-updates", async (req, res) => {
    try {
      const crs = await ChangeRequestService.getBoqUpdateRequired(req.params.projectId);
      res.json(crs);
    } catch (error) {
      console.error("Error fetching Change Requests requiring BoQ updates:", error);
      res.status(500).json({ error: "Failed to fetch Change Requests requiring BoQ updates" });
    }
  });

  // Get Change Requests requiring BIM updates
  app.get("/api/projects/:projectId/change-requests/bim-updates", async (req, res) => {
    try {
      const crs = await ChangeRequestService.getBimUpdateRequired(req.params.projectId);
      res.json(crs);
    } catch (error) {
      console.error("Error fetching Change Requests requiring BIM updates:", error);
      res.status(500).json({ error: "Failed to fetch Change Requests requiring BIM updates" });
    }
  });

  // Bulk approve Change Requests
  app.post("/api/projects/:projectId/change-requests/bulk-approve", async (req, res) => {
    try {
      const { crIds, notes } = req.body;
      if (!Array.isArray(crIds) || crIds.length === 0) {
        return res.status(400).json({ error: "Change Request IDs are required" });
      }

      const userId = (req as any).user?.id || null;
      const approvedCrs = await ChangeRequestService.bulkApprove(crIds, userId, notes);
      res.json({ success: true, approvedCount: approvedCrs.length, changeRequests: approvedCrs });
    } catch (error) {
      console.error("Error bulk approving Change Requests:", error);
      res.status(500).json({ error: "Failed to bulk approve Change Requests" });
    }
  });

  // Get related Change Requests (from same RFI)
  app.get("/api/rfis/:rfiId/change-requests", async (req, res) => {
    try {
      const relatedCrs = await ChangeRequestService.getRelatedChangeRequests(req.params.rfiId);
      res.json(relatedCrs);
    } catch (error) {
      console.error("Error fetching related Change Requests:", error);
      res.status(500).json({ error: "Failed to fetch related Change Requests" });
    }
  });
}
