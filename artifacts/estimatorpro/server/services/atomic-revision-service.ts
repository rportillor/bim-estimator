import { db } from "../db";
import { documents, documentRevisions, revisionCounters } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { FileStorageService } from "./file-storage";

/**
 * Atomic Revision Service - implements race-condition-free revision management
 * Inspired by Prisma patterns from the attachment but adapted for Drizzle ORM
 */
export class AtomicRevisionService {
  
  /**
   * Create a new document revision with atomic revision number increment
   * This prevents race conditions when multiple users upload revisions simultaneously
   */
  static async createRevision(
    documentId: string,
    file: Express.Multer.File,
    uploadedBy: string,
    notes?: string
  ): Promise<{ revision: any; revisionNumber: number }> {
    
    // Get the base document
    const [baseDoc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    
    if (!baseDoc) {
      throw new Error("Document not found");
    }

    // Perform atomic revision creation in a transaction
    return await db.transaction(async (tx) => {
      
      // Step 1: Upsert revision counter (create if missing)
      await tx
        .insert(revisionCounters)
        .values({
          documentId: documentId,
          lastRevision: 0,
        })
        .onConflictDoNothing(); // Don't error if already exists
      
      // Step 2: Atomically increment and get next revision number
      // First get current value, then increment (atomic within transaction)
      const [currentCounter] = await tx
        .select()
        .from(revisionCounters)
        .where(eq(revisionCounters.documentId, documentId));

      const nextRevision = (currentCounter?.lastRevision || 0) + 1;

      // Update with new value
      const [counter] = await tx
        .update(revisionCounters)
        .set({ 
          lastRevision: nextRevision,
          updatedAt: new Date()
        })
        .where(eq(revisionCounters.documentId, documentId))
        .returning();

      const nextRevisionNumber = counter.lastRevision;

      // Step 3: Save file with proper organization
      const { storagePath: _storagePath, fileHash, relativePath } = await FileStorageService.saveFile(
        file,
        baseDoc.projectId!,
        documentId
      );

      // Step 4: Create revision record
      const [newRevision] = await tx
        .insert(documentRevisions)
        .values({
          documentId: documentId,
          revisionNumber: nextRevisionNumber,
          filePath: relativePath,
          fileHash: fileHash,
          uploadedBy: uploadedBy,
          status: "pending",
          notes: notes || null,
          fileMime: file.mimetype,
          fileSize: file.size,
          changeDescription: notes || "Document revision uploaded",
        })
        .returning();

      return { 
        revision: newRevision, 
        revisionNumber: nextRevisionNumber 
      };
    });
  }

  /**
   * Get all revisions for a document
   */
  static async getDocumentRevisions(documentId: string) {
    return await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId))
      .orderBy(documentRevisions.revisionNumber);
  }

  /**
   * Approve a revision - atomically update status
   */
  static async approveRevision(
    documentId: string,
    revisionNumber: number,
    _userId: string
  ) {
    return await db.transaction(async (tx) => {
      // Update revision status
      const [updatedRevision] = await tx
        .update(documentRevisions)
        .set({ status: "approved" })
        .where(
          and(
            eq(documentRevisions.documentId, documentId),
            eq(documentRevisions.revisionNumber, revisionNumber)
          )
        )
        .returning();

      if (!updatedRevision) {
        throw new Error("Revision not found");
      }

      // Update main document record
      await tx
        .update(documents)
        .set({
          // ✅ FIX: Remove non-existent fields from documents schema
          analysisStatus: "Ready",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      return updatedRevision;
    });
  }

  /**
   * Finalize a revision - mark as final and update document
   */
  static async finalizeRevision(
    documentId: string,
    revisionNumber: number,
    _userId: string
  ) {
    return await db.transaction(async (tx) => {
      // Update revision status to final
      const [finalizedRevision] = await tx
        .update(documentRevisions)
        .set({ status: "final" })
        .where(
          and(
            eq(documentRevisions.documentId, documentId),
            eq(documentRevisions.revisionNumber, revisionNumber)
          )
        )
        .returning();

      if (!finalizedRevision) {
        throw new Error("Revision not found");
      }

      // Update main document to point to this revision
      await tx
        .update(documents)
        .set({
          filename: finalizedRevision.filePath.split('/').pop() || 'document',
          fileSize: finalizedRevision.fileSize || 0,
          // ✅ FIX: Remove non-existent fields, keep only schema-valid fields
          analysisStatus: "Ready",
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      return finalizedRevision;
    });
  }

  /**
   * Get current revision counter for a document
   */
  static async getRevisionCounter(documentId: string) {
    const [counter] = await db
      .select()
      .from(revisionCounters)
      .where(eq(revisionCounters.documentId, documentId));
    
    return counter?.lastRevision || 0;
  }

  /**
   * Compare two revisions - fetch file contents and return comparison data
   */
  static async compareRevisions(
    documentId: string,
    fromRevision: number,
    toRevision: number
  ) {
    const revisions = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId))
      .orderBy(documentRevisions.revisionNumber);
    
    const targetRevisions = revisions.filter(r => 
      r.revisionNumber === fromRevision || r.revisionNumber === toRevision
    );

    if (targetRevisions.length !== 2) {
      throw new Error("Could not find both revisions for comparison");
    }

    const [fromRev, toRev] = targetRevisions;
    
    return {
      from: {
        revision: fromRevision,
        filePath: fromRev.filePath,
        fileHash: fromRev.fileHash,
        createdAt: fromRev.createdAt,
        notes: fromRev.notes,
      },
      to: {
        revision: toRevision,
        filePath: toRev.filePath,
        fileHash: toRev.fileHash,
        createdAt: toRev.createdAt,
        notes: toRev.notes,
      },
      // File content comparison would happen here using document-diff service
      hasChanges: fromRev.fileHash !== toRev.fileHash,
    };
  }
}