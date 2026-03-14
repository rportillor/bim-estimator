// server/services/cascade-delete.ts
// Optimized cascade deletion with proper error handling

import { db } from "../db";
import { bimModels, bimElements } from "@shared/schema";
import { eq } from "drizzle-orm";
import { BimError } from "../middleware/error-handler";

export async function safeDeleteModel(modelId: string): Promise<{ deleted: boolean; elementsDeleted: number }> {
  try {
    return await db.transaction(async (tx) => {
      // Count elements first for feedback
      const elements = await tx.select({ id: bimElements.id }).from(bimElements).where(eq(bimElements.modelId, modelId));
      const elementsCount = elements.length;
      
      // DELETE model first - CASCADE will handle elements automatically
      const result = await tx.delete(bimModels).where(eq(bimModels.id, modelId)).returning({ id: bimModels.id });
      
      if (result.length === 0) {
        throw new BimError("Model not found", 404, "MODEL_NOT_FOUND", { modelId });
      }
      
      console.log(`✅ [CASCADE] Deleted model ${modelId} with ${elementsCount} elements`);
      
      return {
        deleted: true,
        elementsDeleted: elementsCount
      };
    });
  } catch (error: any) {
    if (error instanceof BimError) throw error;
    
    throw new BimError(
      `Failed to delete model ${modelId}`, 
      500, 
      "DELETE_MODEL_FAILED",
      { modelId, originalError: error.message }
    );
  }
}

export async function bulkDeleteModels(modelIds: string[]): Promise<{ deleted: number; elementsDeleted: number }> {
  let totalDeleted = 0;
  let totalElements = 0;
  
  for (const modelId of modelIds) {
    try {
      const result = await safeDeleteModel(modelId);
      if (result.deleted) {
        totalDeleted++;
        totalElements += result.elementsDeleted;
      }
    } catch (error) {
      console.error(`Failed to delete model ${modelId}:`, error);
      // Continue with other models
    }
  }
  
  return { deleted: totalDeleted, elementsDeleted: totalElements };
}