// server/helpers/site-symbols.ts
import crypto from "crypto";

type XY = { x:number; y:number };
type Storey = { name?:string; elevation?:number };

export function mapPagePointToModel(
  px:number, py:number,
  pageW:number, pageH:number,
  bbox:{minX:number; minY:number; maxX:number; maxY:number}
){
  // Normalize page (origin top-left); invert Y for model's up/N
  const u = Math.max(0, Math.min(1, px / Math.max(1,pageW)));
  const v = Math.max(0, Math.min(1, py / Math.max(1,pageH)));
  const x = bbox.minX + u*(bbox.maxX - bbox.minX);
  const y = bbox.minY + (1 - v)*(bbox.maxY - bbox.minY);
  return { x, y };
}

export function placeDetectedSymbolsAsElements(args:{
  hits: Array<{ type:string; x:number; y:number; pageWidth:number; pageHeight:number }>;
  storeys: Storey[];
  modelBBox: { minX:number; minY:number; maxX:number; maxY:number };
}){
  const out:any[]=[];
  const lvls = args.storeys?.length ? args.storeys : [{ name:"L1", elevation: 0 }];
  for (const h of args.hits){
    const pos = mapPagePointToModel(h.x, h.y, h.pageWidth, h.pageHeight, args.modelBBox);
    const zLift = h.type==="LIGHT_FIXTURE" ? 2.8 : h.type==="SPRINKLER" ? 2.6 : h.type==="RECEPTACLE" ? 0.3 : 1.0;
    for (const s of lvls){
      out.push({
        id: `${h.type}_${crypto.randomBytes(4).toString('hex')}`,
        elementType: h.type,
        properties: { ai_generated:true, source:"raster", confidence: null }, // confidence not available from hit type — caller must supply score if known
        geometry: {
          location: { realLocation: { x: pos.x, y: pos.y, z: Number(s?.elevation||0) + zLift } },
          dimensions: { width: 0.18, height: 0.18, depth: 0.18 }
        },
        storey: { name: s?.name || "", elevation: Number(s?.elevation||0) }
      });
    }
  }
  return out;
}

// Legacy function - keeping for backward compatibility
export function placeDetectedSymbolsAsElements_LEGACY(
  detections: { pageId:string; imagePath:string; hits: { cx_norm:number; cy_norm:number; score:number }[] }[],
  dims: { width:number; length:number },
  label: string,
  z = 0
) {
  const out: any[] = [];
  for (const det of detections) {
    for (const h of det.hits) {
      const x = h.cx_norm * dims.width;
      const y = h.cy_norm * dims.length;
      out.push({
        id: `site:${label}:${det.pageId}:${Math.round(x*100)}:${Math.round(y*100)}`,
        type: `SITE_SYMBOL:${label.toUpperCase()}`,
        name: `${label} (auto)`,
        properties: { source: "raster", score: h.score, pageId: det.pageId, image: det.imagePath, insideProperty: undefined },
        geometry: {
          location: { realLocation: { x, y, z } },
          dimensions: { width: 0.3, depth: 0.3, height: 0.1 } // tiny marker for viewer
        }
      });
    }
  }
  return out;
}