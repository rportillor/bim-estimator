// client/src/lib/bim-api.ts
// ✅ FIX: Use standardized BIM element interface from shared schema
import type { BimElement } from "@shared/schema";

// Re-export with consistent naming (BIMElement for frontend compatibility)
export type BIMElement = BimElement;

// Legacy interface mapping for backward compatibility  
export interface LegacyBIMElement {
  id: string;
  type: string;
  name?: string;
  category?: string;
  geometry?: any;
  properties?: any;
  storey?: any;
}

export interface BIMElementsResponse {
  data: BIMElement[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
}

/**
 * Fetch all BIM elements for a model, automatically handling pagination
 */
export async function fetchAllModelElements(
  modelId: string,
  batchSize: number = 1000
): Promise<BIMElement[]> {
  
  // Try to get all at once first
  try {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(`/api/bim/models/${modelId}/elements?all=true`, { headers, credentials: "include" }).catch(err => {
      console.error('Failed to fetch all elements:', err);
      throw err;
    });
    if (response.ok) {
      const result: BIMElementsResponse = await response.json();
      return result.data;
    }
  } catch (error) {
    console.warn('Failed to fetch all elements, falling back to pagination:', error);
  }
  
  // Fallback to pagination
  const allElements: BIMElement[] = [];
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    try {
      const token = localStorage.getItem("auth_token");
      const paginationHeaders: Record<string, string> = {};
      if (token) paginationHeaders["Authorization"] = `Bearer ${token}`;
      const response = await fetch(
        `/api/bim/models/${modelId}/elements?offset=${offset}&limit=${batchSize}`,
        { headers: paginationHeaders, credentials: "include" }
      ).catch(err => {
        console.error('Failed to fetch elements batch:', err);
        throw err;
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: BIMElementsResponse = await response.json();
      allElements.push(...result.data);
      
      hasMore = result.data.length === batchSize && allElements.length < result.pagination.total;
      offset += batchSize;
      
    } catch (error) {
      console.error(`Failed to fetch elements batch at offset ${offset}:`, error);
      break;
    }
  }
  
  return allElements;
}