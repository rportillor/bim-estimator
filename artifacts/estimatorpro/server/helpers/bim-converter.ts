// server/helpers/bim-converter.ts
import { computePositionForElement, type BuildingAnalysis, type PositioningMode } from "./positioning";
import { parseDimensionString } from "./parse-dimensions";
import { inferStoreyElevation } from "./storeys";

export type RealBIMElement = {
  id: string; type?: string; category?: string; name?: string;
  size?: { x?: number; y?: number; z?: number };
  dimensions?: { width?: number; height?: number; depth?: number } | string;
  location?: { x?: number; y?: number; z?: number };
  coordinates?: { x?: number; y?: number; z?: number };
  vertices?: Array<{ x: number; y: number; z: number }>;
  properties?: Record<string, any>;
  storeyName?: string; storeyGuid?: string; elevation?: number;
};

function coerceDims(real: RealBIMElement){
  // Priority order for dimension sources:
  // 1. real.dimensions (top-level, string or object)
  // 2. real.geometry.dimensions (written by real-qto-processor createWallElement etc.)
  // 3. real.properties.width/height/depth/thickness
  // 4. real.size
  // 5. 1x1x1 placeholder
  let w=Number((real as any)?.dimensions?.width), h=Number((real as any)?.dimensions?.height), d=Number((real as any)?.dimensions?.depth);
  if (!Number.isFinite(w)||!Number.isFinite(h)||!Number.isFinite(d)){
    if (typeof real.dimensions==="string"){
      const p=parseDimensionString(real.dimensions); if(p?.width) w=p.width; if(p?.height) h=p.height; if(p?.depth) d=p.depth;
    }
  }
  // BUG FIX (v15.4): check geometry.dimensions — real-qto-processor stores dims there
  // geometry.dimensions: { length, width, height } where length=span for walls/beams
  const gd = (real as any)?.geometry?.dimensions;
  if (gd && typeof gd === 'object') {
    if (!Number.isFinite(w) && Number.isFinite(gd.width))  w = Number(gd.width);
    if (!Number.isFinite(w) && Number.isFinite(gd.length)) w = Number(gd.length);
    if (!Number.isFinite(h) && Number.isFinite(gd.height)) h = Number(gd.height);
    if (!Number.isFinite(d) && Number.isFinite(gd.depth))  d = Number(gd.depth);
    // For walls: geometry.dimensions.width is thickness; gd.length is span
    if (!Number.isFinite(d) && Number.isFinite(gd.width) && Number.isFinite(gd.length)) {
      d = Number(gd.width);
    }
  }
  const P=real.properties||{};
  if(!Number.isFinite(w)&&Number.isFinite(P.width))w=Number(P.width);
  if(!Number.isFinite(h)&&Number.isFinite(P.height))h=Number(P.height);
  if(!Number.isFinite(d)&&Number.isFinite(P.depth)) d=Number(P.depth);
  if(!Number.isFinite(d)&&Number.isFinite(P.thickness)) d=Number(P.thickness);
  if(!Number.isFinite(w)) w=Number(real.size?.x ?? 1);
  if(!Number.isFinite(h)) h=Number(real.size?.y ?? 1);
  if(!Number.isFinite(d)) d=Number(real.size?.z ?? 1);
  return { width: Math.max(.01,w||1), height: Math.max(.01,h||1), depth: Math.max(.01,d||1) };
}

export function convertRealElementToLegacyFormat(
  real: RealBIMElement, idx:number, total:number, buildingAnalysis?: BuildingAnalysis|null,
  mode: PositioningMode = (process.env.POSITIONING_MODE as PositioningMode) || "auto"
){
  const dims = coerceDims(real);
  const existing = (real as any)?.geometry?.location?.realLocation || real.properties?.realLocation || real.location || real.coordinates;
  // Get floor height from Claude's analysis if available (no default heights)
  const floorHeightMm = (buildingAnalysis as any)?.building_specifications?.floor_height_mm || 
                         (buildingAnalysis as any)?.floor_height_mm;
  const inferredElevation = inferStoreyElevation(real.storeyName, floorHeightMm);
  // Use actual elevation or Claude's inferred elevation, default to 0 only for ground floor
  const elevation = Number.isFinite(real.elevation) ? Number(real.elevation) : (inferredElevation ?? 0);
  const storey = { name: real.storeyName, elevation };
  const pos = computePositionForElement({
    index: idx, total: Math.max(1,total), storey, existing:{real:existing as any},
    analysis: buildingAnalysis||null, elementType: real.type||real.category, mode, typeAware:true,
  });

  return {
    id: real.id,
    type: real.type || real.category || "Generic",
    name: real.name || "",
    category: real.category || "Uncategorized",
    coordinates: pos,  // ADD THIS for database storage
    dimensions: dims,  // ADD THIS for direct access
    geometry: { dimensions: dims, location: { realLocation: pos }, vertices: Array.isArray(real.vertices) ? real.vertices : undefined },
    properties: { ...(real.properties||{}), realLocation: pos },
    storey: real.storeyName ? { name: real.storeyName, elevation: storey.elevation, guid: real.storeyGuid } : undefined,
  };
}

/**
 * Get document file path for processing (utility function)
 */
export function getDocumentPath(document: any): string | undefined {
  // v15.13: Return the real storageKey-based path that loadFileBuffer can resolve.
  // Priority: storageKey (canonical) → filePath → storagePath → path → constructed
  if (!document) return undefined;

  // storageKey is the field written by FileStorageService on upload — use it first.
  if (document.storageKey) {
    const p = document.storageKey.startsWith('uploads/')
      ? document.storageKey
      : `uploads/${document.storageKey}`;
    return p;
  }

  if (document.filePath)    return document.filePath;
  if (document.storagePath) return document.storagePath;
  if (document.path)        return document.path;
  if (document.url)         return document.url;

  if (document.filename) {
    // Last resort: uploads/<basename> — matches loadFileBuffer candidate list
    const path = require('path');
    return `uploads/${path.basename(document.filename)}`;
  }

  return undefined;
}