import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { 
  rfis, 
  rfiResponses, 
  rfiAttachments,
  documents,
  projects,
  users,
  type InsertRfi, 
  type InsertRfiResponse, 
  type InsertRfiAttachment,
  type Rfi,
  type RfiResponse,
  type RfiAttachment
} from "@shared/schema";
import { generateRfiNumber } from "../utils/rfi-utils";

export class RfiService {
  // Create new RFI
  static async createRfi(data: InsertRfi): Promise<Rfi> {
    // Generate unique RFI number if not provided
    if (!data.rfiNumber) {
      data.rfiNumber = await generateRfiNumber(data.projectId);
    }

    const [newRfi] = await db.insert(rfis).values(data).returning();
    return newRfi;
  }

  // Get RFIs for a project
  static async getProjectRfis(projectId: string): Promise<Rfi[]> {
    const projectRfis = await db
      .select()
      .from(rfis)
      .where(eq(rfis.projectId, projectId))
      .orderBy(desc(rfis.createdAt));
    
    return projectRfis;
  }

  // Get RFI with details (responses, attachments)
  static async getRfiWithDetails(rfiId: string) {
    const [rfi] = await db
      .select()
      .from(rfis)
      .where(eq(rfis.id, rfiId));

    if (!rfi) {
      throw new Error("RFI not found");
    }

    const responses = await db
      .select()
      .from(rfiResponses)
      .where(eq(rfiResponses.rfiId, rfiId))
      .orderBy(rfiResponses.createdAt);

    const attachments = await db
      .select()
      .from(rfiAttachments)
      .where(eq(rfiAttachments.rfiId, rfiId))
      .orderBy(rfiAttachments.createdAt);

    return {
      rfi,
      responses,
      attachments
    };
  }

  // Add response to RFI
  static async addResponse(data: InsertRfiResponse): Promise<RfiResponse> {
    const [newResponse] = await db
      .insert(rfiResponses)
      .values(data)
      .returning();

    // If this is an official response, update the RFI status
    if (data.isOfficial) {
      await db
        .update(rfis)
        .set({
          status: "Responded",
          answeredBy: data.responderId || null,
          answeredAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(rfis.id, data.rfiId));
    }

    return newResponse;
  }

  // Add attachment to RFI
  static async addAttachment(data: InsertRfiAttachment): Promise<RfiAttachment> {
    const [newAttachment] = await db
      .insert(rfiAttachments)
      .values(data)
      .returning();

    return newAttachment;
  }

  // Update RFI status
  static async updateRfiStatus(rfiId: string, status: string, userId?: string): Promise<Rfi> {
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (status === "Closed" && userId) {
      updateData.answeredBy = userId;
      updateData.answeredAt = new Date();
    }

    const [updatedRfi] = await db
      .update(rfis)
      .set(updateData)
      .where(eq(rfis.id, rfiId))
      .returning();

    return updatedRfi;
  }

  // Get RFIs generated from document conflicts
  static async getConflictGeneratedRfis(projectId: string): Promise<Rfi[]> {
    return db
      .select()
      .from(rfis)
      .where(
        and(
          eq(rfis.projectId, projectId),
          eq(rfis.generatedFromConflict, true)
        )
      )
      .orderBy(desc(rfis.createdAt));
  }

  // AI-Enhanced: Generate RFI from document conflicts
  static async generateRfiFromConflict(
    projectId: string,
    conflictData: any,
    submittedBy: string
  ): Promise<Rfi> {
    const rfiNumber = await generateRfiNumber(projectId);
    
    const rfiData: InsertRfi = {
      projectId,
      rfiNumber,
      subject: `Document Conflict: ${conflictData.type}`,
      question: `AI has detected a potential conflict between documents. ${conflictData.description}. Please clarify the correct interpretation.`,
      priority: conflictData.severity === "high" ? "High" : "Medium",
      fromName: "AI System",
      fromCompany: "EstimatorPro",
      toName: "Project Manager", // Could be customized
      toCompany: "",
      generatedFromConflict: true,
      relatedConflicts: [conflictData],
      impactAssessment: conflictData.impactAnalysis
    };

    return this.createRfi(rfiData);
  }

  // Get RFI statistics for dashboard
  static async getRfiStats(projectId: string) {
    const allRfis = await this.getProjectRfis(projectId);
    
    const stats = {
      total: allRfis.length,
      open: allRfis.filter(r => r.status === "Open").length,
      inProgress: allRfis.filter(r => r.status === "In Progress").length,
      responded: allRfis.filter(r => r.status === "Responded").length,
      closed: allRfis.filter(r => r.status === "Closed").length,
      aiGenerated: allRfis.filter(r => r.generatedFromConflict).length
    };

    return stats;
  }

  // Search RFIs
  static async searchRfis(projectId: string, query: string): Promise<Rfi[]> {
    // Note: Using basic LIKE search. In production, consider using full-text search
    const searchResults = await db
      .select()
      .from(rfis)
      .where(
        and(
          eq(rfis.projectId, projectId),
          // Basic text search - can be enhanced with PostgreSQL full-text search
        )
      )
      .orderBy(desc(rfis.createdAt));

    // Filter results in memory for now (can be optimized with PostgreSQL functions)
    return searchResults.filter(rfi => 
      rfi.subject.toLowerCase().includes(query.toLowerCase()) ||
      rfi.question.toLowerCase().includes(query.toLowerCase()) ||
      rfi.rfiNumber.toLowerCase().includes(query.toLowerCase())
    );
  }
}