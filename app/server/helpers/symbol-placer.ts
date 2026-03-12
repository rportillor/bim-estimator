// server/helpers/symbol-placer.ts
import crypto from "crypto";

type XY = { x:number; y:number };
type Storey = { name?:string; elevation?:number };

function uid(pfx:string){ return `${pfx}_${crypto.randomBytes(4).toString('hex')}`; }

function evenOddInside(pt:XY, poly:XY[]|null){
  if (!poly || poly.length<3) return true;
  let c=false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i], b=poly[j];
    if (((a.y>pt.y)!==(b.y>pt.y)) && (pt.x < (b.x-a.x)*(pt.y-a.y)/((b.y-a.y)||1e-9)+a.x)) c=!c;
  }
  return c;
}

function bbox(foot:XY[]|null, fallback:{minX:number;minY:number;maxX:number;maxY:number}){
  if (foot && foot.length>=3) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const p of foot){ if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x; if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y; }
    return {minX,minY,maxX,maxY};
  }
  return fallback;
}

function placeGrid(kind:string, spacing:number, storeys:Storey[], footprint:XY[]|null, fallbackBBox:{minX:number;minY:number;maxX:number;maxY:number}, zHeights:{[k:string]:number}){
  const bb = bbox(footprint, fallbackBBox);
  const out:any[]=[];
  const z0 = zHeights[kind] ?? 2.8;
  const lvls = storeys?.length ? storeys : [{ name:"L1", elevation: 0 }];
  for (const s of lvls){
    const z = Number(s?.elevation||0) + z0;
    for (let x=bb.minX; x<=bb.maxX; x+=spacing){
      for (let y=bb.minY; y<=bb.maxY; y+=spacing){
        if (!evenOddInside({x,y}, footprint)) continue;
        out.push({
          id: uid(kind.toLowerCase()),
          elementType: kind,
          properties: { dimensions:{ width:0.15,height:0.15,depth:0.15 } },
          geometry: { location:{ realLocation:{ x,y,z } }, dimensions:{ width:0.15,height:0.15,depth:0.15 } },
          storey: { name: s?.name||"", elevation: Number(s?.elevation||0) }
        });
      }
    }
  }
  return out;
}

export function placeFromDrawingFacts(args:{
  facts:{
    lighting?: { spacing?:number } | null;
    sprinklers?: { spacing?:number } | null;
    receptacles?: { spacing?:number } | null;
    panels?: Array<{ tag:string; amps?:number; circuits?:number; x?:number; y?:number; level?:number }>;
  };
  storeys: Storey[];
  footprint: XY[] | null;
  fallbackBBox: { minX:number;minY:number;maxX:number;maxY:number };
}) {
  const out:any[]=[];
  const zHeights = { LIGHT_FIXTURE:2.8, SPRINKLER:2.6, RECEPTACLE:0.3 };
  if (args.facts?.lighting?.spacing)    out.push(...placeGrid("LIGHT_FIXTURE",    args.facts.lighting.spacing,    args.storeys, args.footprint, args.fallbackBBox, zHeights));
  if (args.facts?.sprinklers?.spacing)  out.push(...placeGrid("SPRINKLER",        args.facts.sprinklers.spacing,  args.storeys, args.footprint, args.fallbackBBox, zHeights));
  if (args.facts?.receptacles?.spacing) out.push(...placeGrid("RECEPTACLE",       args.facts.receptacles.spacing, args.storeys, args.footprint, args.fallbackBBox, zHeights));

  for (const p of args.facts?.panels || []) {
    const x = Number(p.x ?? 0), y = Number(p.y ?? 0), z = Number(p.level ?? 0);
    out.push({
      id: uid("panel"),
      elementType: "PANEL",
      properties: { tag: p.tag, amps: p.amps ?? null, circuits: p.circuits ?? null, dimensions:{ width:0.6,height:1.8,depth:0.25 } },
      geometry: { location:{ realLocation:{ x,y,z } }, dimensions:{ width:0.6,height:1.8,depth:0.25 } }
    });
  }
  return out;
}