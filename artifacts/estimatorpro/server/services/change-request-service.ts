import { eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { 
  changeRequests,
  changeRequestAttachments,
  type InsertChangeRequest, 
  type InsertChangeRequestAttachment,
  type ChangeRequest,
  type ChangeRequestAttachment
} from "@shared/schema";

export class ChangeRequestService {
  // Create new Change Request
  static async createChangeRequest(data: InsertChangeRequest): Promise<ChangeRequest> {
    const [newCr] = await db.insert(changeRequests).values(data).returning();
    return newCr;
  }

  // Get Change Requests for a project
  static async getProjectChangeRequests(projectId: string): Promise<ChangeRequest[]> {
    const projectCRs = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.projectId, projectId))
      .orderBy(desc(changeRequests.createdAt));
    
    return projectCRs;
  }

  // Get Change Request with details
  static async getChangeRequestWithDetails(crId: string) {
    const [cr] = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.id, crId));

    if (!cr) {
      throw new Error("Change Request not found");
    }

    const attachments = await db
      .select()
      .from(changeRequestAttachments)
      .where(eq(changeRequestAttachments.changeRequestId, crId))
      .orderBy(changeRequestAttachments.createdAt);

    return {
      changeRequest: cr,
      attachments
    };
  }

  // Add attachment to Change Request
  static async addAttachment(data: InsertChangeRequestAttachment): Promise<ChangeRequestAttachment> {
    const [newAttachment] = await db
      .insert(changeRequestAttachments)
      .values(data)
      .returning();

    return newAttachment;
  }

  // Update Change Request status
  static async updateStatus(
    crId: string, 
    status: string, 
    userId: string,
    notes?: string
  ): Promise<ChangeRequest> {
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    switch (status) {
      case "Under Review":
        updateData.reviewedBy = userId;
        updateData.reviewedAt = new Date();
        if (notes) updateData.reviewNotes = notes;
        break;
      case "Approved":
        updateData.approvedBy = userId;
        updateData.approvedAt = new Date();
        if (notes) updateData.reviewNotes = notes;
        break;
      case "Rejected":
        updateData.reviewedBy = userId;
        updateData.reviewedAt = new Date();
        if (notes) updateData.rejectionReason = notes;
        break;
      case "Implemented":
        updateData.implementedBy = userId;
        updateData.implementedAt = new Date();
        if (notes) updateData.implementationNotes = notes;
        break;
    }

    const [updatedCr] = await db
      .update(changeRequests)
      .set(updateData)
      .where(eq(changeRequests.id, crId))
      .returning();

    return updatedCr;
  }

  // AI-Enhanced: Analyze impact of change request
  static async analyzeImpact(crId: string, aiAnalysis: any): Promise<ChangeRequest> {
    const [updatedCr] = await db
      .update(changeRequests)
      .set({
        aiGeneratedImpact: aiAnalysis,
        affectedBoqItems: aiAnalysis.affectedBoqItems || [],
        affectedDocuments: aiAnalysis.affectedDocuments || [],
        estimateRevisionRequired: aiAnalysis.estimateRevisionRequired || false,
        bimModelUpdateRequired: aiAnalysis.bimModelUpdateRequired || false,
        costImpact: aiAnalysis.estimatedCostImpact || null,
        scheduleImpact: aiAnalysis.estimatedScheduleImpact || null,
        updatedAt: new Date()
      })
      .where(eq(changeRequests.id, crId))
      .returning();

    return updatedCr;
  }

  // Get Change Request statistics
  static async getChangeRequestStats(projectId: string) {
    const allCRs = await this.getProjectChangeRequests(projectId);
    
    const stats = {
      total: allCRs.length,
      pending: allCRs.filter(cr => cr.status === "Pending").length,
      underReview: allCRs.filter(cr => cr.status === "Under Review").length,
      approved: allCRs.filter(cr => cr.status === "Approved").length,
      rejected: allCRs.filter(cr => cr.status === "Rejected").length,
      implemented: allCRs.filter(cr => cr.status === "Implemented").length,
      totalCostImpact: allCRs
        .filter(cr => cr.status === "Approved" && cr.costImpact)
        .reduce((sum, cr) => sum + (Number(cr.costImpact) || 0), 0),
      averageApprovalTime: this.calculateAverageApprovalTime(allCRs)
    };

    return stats;
  }

  // Calculate average approval time
  private static calculateAverageApprovalTime(crs: ChangeRequest[]): number {
    const approvedCRs = crs.filter(cr => 
      cr.status === "Approved" && 
      cr.submittedAt && 
      cr.approvedAt
    );

    if (approvedCRs.length === 0) return 0;

    const totalDays = approvedCRs.reduce((sum, cr) => {
      const submitted = new Date(cr.submittedAt!);
      const approved = new Date(cr.approvedAt!);
      const diffTime = approved.getTime() - submitted.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return sum + diffDays;
    }, 0);

    return Math.round(totalDays / approvedCRs.length);
  }

  // Get Change Requests requiring BoQ updates
  static async getBoqUpdateRequired(projectId: string): Promise<ChangeRequest[]> {
    return db
      .select()
      .from(changeRequests)
      .where(
        and(
          eq(changeRequests.projectId, projectId),
          eq(changeRequests.status, "Approved"),
          eq(changeRequests.estimateRevisionRequired, true)
        )
      )
      .orderBy(desc(changeRequests.approvedAt));
  }

  // Get Change Requests requiring BIM updates
  static async getBimUpdateRequired(projectId: string): Promise<ChangeRequest[]> {
    return db
      .select()
      .from(changeRequests)
      .where(
        and(
          eq(changeRequests.projectId, projectId),
          eq(changeRequests.status, "Approved"),
          eq(changeRequests.bimModelUpdateRequired, true)
        )
      )
      .orderBy(desc(changeRequests.approvedAt));
  }

  // Search Change Requests
  static async searchChangeRequests(projectId: string, query: string): Promise<ChangeRequest[]> {
    const searchResults = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.projectId, projectId))
      .orderBy(desc(changeRequests.createdAt));

    // Filter results in memory for now
    return searchResults.filter(cr => 
      cr.title.toLowerCase().includes(query.toLowerCase()) ||
      cr.description.toLowerCase().includes(query.toLowerCase()) ||
      cr.reason.toLowerCase().includes(query.toLowerCase())
    );
  }

  // Bulk approve Change Requests
  static async bulkApprove(crIds: string[], userId: string, notes?: string): Promise<ChangeRequest[]> {
    const results: ChangeRequest[] = [];
    
    for (const crId of crIds) {
      const updatedCr = await this.updateStatus(crId, "Approved", userId, notes);
      results.push(updatedCr);
    }

    return results;
  }

  // Get related Change Requests (from same RFI)
  static async getRelatedChangeRequests(rfiId: string): Promise<ChangeRequest[]> {
    return db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.rfiId, rfiId))
      .orderBy(desc(changeRequests.createdAt));
  }
}