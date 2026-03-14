// server/helpers/lod-expander.ts
/**
 * 🚫 DOCUMENT-ONLY PROCESSING: Controls artificial element expansion
 * Elements must come from actual construction documents - no artificial expansion
 * without document evidence. This module handles LOD expansion with proper control.
 */
import crypto from "crypto";

// 🔧 LOD EXPANSION CONTROL FLAGS
const _SKIP_LOD_ARTIFICIAL_EXPANSION = true; // DISABLED - use only real document elements
const _DOCUMENT_ONLY_MODE = true; // Only expand elements found in documents

type XY = { x:number; y:number };
type Storey = { name?: string; elevation?: number };

function uid(prefix:string){ return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }

function bboxFrom(elements:any[]){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const e of elements||[]){
    const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry;
    const p = g?.location?.realLocation; if (!p) continue;
    // Convert to millimeters if coordinates appear to be in meters (abs value < 100)
    let x = p.x, y = p.y;
    if (Math.abs(x) < 100) x *= 1000;
    if (Math.abs(y) < 100) y *= 1000;
    if (x<minX)minX=x; if (x>maxX)maxX=x;
    if (y<minY)minY=y; if (y>maxY)maxY=y;
  }
  // No elements — return null; caller must handle missing bbox without inventing dimensions
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function inside(poly: XY[]|null, x:number, y:number){
  if (!poly || poly.length<3) return true;
  // even-odd
  let c=false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i], b=poly[j];
    if (((a.y>y)!==(b.y>y)) && (x < (b.x-a.x)*(y-a.y)/((b.y-a.y)||1e-9)+a.x)) c=!c;
  }
  return c;
}

function makeGeomBox(pos:{x:number;y:number;z:number}, dims:{w:number;h:number;d:number}){
  return {
    location: { realLocation: { x: pos.x, y: pos.y, z: pos.z } },
    dimensions: { width: dims.w, height: dims.h, depth: dims.d }
  };
}

function cloneAcrossStoreys(base:any[], storeys:Storey[]){
  if (!storeys?.length) return base;
  const out:any[]=[]; 
  for (const s of storeys){
    const elev = Number(s?.elevation||0);
    for (const e of base){
      const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : (e?.geometry||{});
      const p = g?.location?.realLocation || {x:0,y:0,z:0};
      const ng = { ...g, location: { realLocation: { x:p.x, y:p.y, z:(p.z||0)+elev } } };
      out.push({ ...e, id: uid("copy"), geometry: ng, storey: { name: s?.name||"", elevation: elev } });
    }
  }
  return out;
}

function splitLongWall(e:any, maxSeg=3.0){
  const p = e?.properties || {};
  const s = p?.start || p?.p1 || null; const t = p?.end || p?.p2 || null;
  if (!s || !t) return [e];
  const dx = t.x - s.x, dy = t.y - s.y;
  const L = Math.hypot(dx, dy);
  if (L <= maxSeg) return [e];
  const n = Math.max(2, Math.ceil(L / maxSeg));
  const out:any[]=[];
  for (let i=0;i<n;i++){
    const a = i/n, b=(i+1)/n;
    const sx = s.x + dx*a, sy = s.y + dy*a;
    const ex = s.x + dx*b, ey = s.y + dy*b;
    const part = {
      ...e,
      id: uid("wallseg"),
      properties: { ...p, start:{x:sx,y:sy}, end:{x:ex,y:ey} }
    };
    out.push(part);
  }
  return out;
}

function panelizeSlab(e:any, maxPanel=4.0){
  // assume center/size; panelize into ~maxPanel grid
  const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry;
  const p = g?.location?.realLocation || {x:0,y:0,z:0};
  const d = g?.dimensions || {};
  const L = Number(d?.width || d?.length || 6);
  const W = Number(d?.depth || d?.width  || 6);
  const nx = Math.max(1, Math.round(L / maxPanel));
  const ny = Math.max(1, Math.round(W / maxPanel));
  const dx = L / nx, dy = W / ny;
  const out:any[]=[];
  for (let ix=0;ix<nx;ix++){
    for (let iy=0;iy<ny;iy++){
      const cx = p.x - L/2 + dx*(ix+0.5);
      const cy = p.y - W/2 + dy*(iy+0.5);
      out.push({
        ...e,
        id: uid("slabpanel"),
        geometry: { location:{ realLocation:{ x:cx, y:cy, z:p.z }}, dimensions:{ width:dx, height:0.2, depth:dy } }
      });
    }
  }
  return out;
}

function addMEPGrid(kind:"LIGHT"|"SPRINKLER"|"RECEPTACLE", footprint:XY[]|null, storeys:Storey[], bbox:{minX:number;minY:number;maxX:number;maxY:number}, spacing:number|undefined){
  // No MEP generation if spacing not provided from Claude's analysis
  if (!spacing || spacing <= 0) return [];
  
  const {minX,minY,maxX,maxY} = bbox;
  const poly = footprint;
  const out:any[]=[]; 
  for (const s of (storeys?.length ? storeys : [{ name:"Level 0", elevation: 0 }])) {
    // Z elevations in millimeters
    const z = Number(s?.elevation||0) + (kind==="LIGHT" ? 2800 : (kind==="SPRINKLER" ? 2600 : 300));
    for (let x=minX; x<=maxX; x+=spacing) {
      for (let y=minY; y<=maxY; y+=spacing) {
        if (!inside(poly, x, y)) continue;
        out.push({
          id: uid(kind.toLowerCase()),
          elementType: kind,
          // Dimensions in millimeters
          properties: { dimensions:{ width:150, height:150, depth:150 } },
          geometry: makeGeomBox({x,y,z}, { w:150, h:150, d:150 })
        });
      }
    }
  }
  return out;
}

export function expandWithLod(args: {
  base: any[];
  storeys: Storey[];
  options: {
    families: { structBias:number; archBias:number; mepBias:number };
    includeMechanical: boolean;
    includeElectrical: boolean;
    includePlumbing: boolean;
    elementSplitting: boolean;
    segmentWallsAtOpenings: boolean;
    maxElements: number;
    lod: string;
    density?: { light?:number; sprinkler?:number; receptacle?:number };
    spacing?: { light?:number; sprinkler?:number; receptacle?:number };
    minStructuralFraction: number;
    targetArchitecturalFraction: number;
    maxGridFraction: number;
  };
  footprint: { polygon: XY[] | null };
}) {
  const { base, storeys, options, footprint } = args;
  const maxN   = Math.max(1, Number(options.maxElements || 150000));
  const minStructFrac = Math.min(0.9, Math.max(0.0, options.minStructuralFraction));
  const targArchFrac  = Math.min(0.9, Math.max(0.0, options.targetArchitecturalFraction));
  const maxGridFrac   = Math.min(0.95, Math.max(0.0, options.maxGridFraction));

  const footprintPoly = footprint?.polygon || null;
  const bb = bboxFrom(base);
  let out = [...base];

  // If no bounding box (no elements with geometry), skip enrichment entirely.
  // Structural seeds cannot be placed without real building dimensions from drawings.
  if (!bb) {
    console.warn('🧩 [LOD] no element bounding box — enrichment skipped (no geometry from drawings)');
    return { elements: out, added: 0 };
  }

  console.log(`🧩 [LOD] expand base=${base.length} → target=${maxN}, footprint=${!!footprintPoly}`);

  // 1) replicate base across storeys if they exist but base is only at one elevation
  const hasMultiple = storeys?.length > 1;
  if (hasMultiple) {
    const hasZSpread = (() => {
      const zs = new Set<number>();
      for (const e of out) {
        const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry;
        const p = g?.location?.realLocation; if (p) zs.add(+p.z||0);
      }
      return zs.size > 1;
    })();
    if (!hasZSpread) {
      console.log(`🧩 [LOD] cloning across ${storeys.length} storeys`);
      out = cloneAcrossStoreys(out, storeys);
    }
  }

  // helper counters
  const countFamily = (arr:any[])=>{
    let S=0,A=0,M=0,O=0, G=0;
    for (const e of arr){
      const t = String(e?.elementType || e?.type || e?.category || "").toUpperCase();
      if (/COLUMN|BEAM|FOUNDATION|FOOTING/.test(t)) S++;
      else if (/WALL|WINDOW|DOOR|SLAB|FLOOR|STAIR/.test(t)) A++;
      else if (/LIGHT|SPRINKLER|RECEPTACLE|DUCT|PIPE|VALVE|DIFFUSER|PANEL|MECH|ELECTRICAL|PLUMBING/.test(t)) { M++; G++; }
      else O++;
    }
    return {S,A,M,O,G, total:arr.length};
  };

  // 2) structural & architectural enrichment (splitting/panelizing)
  if (options.elementSplitting) {
    console.log(`🧩 [LOD] splitting/panelizing elements`);
    const next:any[]=[];
    for (const e of out) {
      const t = String(e?.elementType || e?.type || e?.category || "").toUpperCase();
      if (/WALL/.test(t)) next.push(...splitLongWall(e, 3.0));
      else if (/SLAB|FLOOR/.test(t)) next.push(...panelizeSlab(e, 4.0));
      else next.push(e);
    }
    out = next;
    console.log(`🧩 [LOD] after splitting: ${out.length} elements`);
  }

  // 3) expand until target counts with balanced fractions
  let guard = 0;
  while (out.length < maxN && guard++ < 50) {
    const c = countFamily(out);
    const structFrac = c.total ? c.S / c.total : 0;
    const archFrac   = c.total ? c.A / c.total : 0;
    const gridFrac   = c.total ? c.G / c.total : 0;

    console.log(`🧩 [LOD] iteration ${guard}: total=${c.total}, S=${structFrac.toFixed(2)}, A=${archFrac.toFixed(2)}, G=${gridFrac.toFixed(2)}`);

    if (structFrac < minStructFrac) {
      // add structural seeds: columns along perimeter bbox corners/edges
      const add:any[]=[];
      // Column spacing in millimeters
      const step = Math.max(3000, Math.min(8000, (bb.maxX-bb.minX + bb.maxY-bb.minY)/20));
      for (const s of (storeys?.length ? storeys : [{elevation:0}])) {
        const z = Number(s?.elevation||0); // Already in millimeters
        for (let x=bb.minX; x<=bb.maxX; x+=step) {
          add.push({ id: uid("col"), elementType:"COLUMN", geometry: makeGeomBox({x, y:bb.minY, z}, { w:400,h:3200,d:400 })});
          add.push({ id: uid("col"), elementType:"COLUMN", geometry: makeGeomBox({x, y:bb.maxY, z}, { w:400,h:3200,d:400 })});
        }
        for (let y=bb.minY; y<=bb.maxY; y+=step) {
          add.push({ id: uid("col"), elementType:"COLUMN", geometry: makeGeomBox({x:bb.minX, y, z}, { w:400,h:3200,d:400 })});
          add.push({ id: uid("col"), elementType:"COLUMN", geometry: makeGeomBox({x:bb.maxX, y, z}, { w:400,h:3200,d:400 })});
        }
      }
      out = out.concat(add);
      console.log(`🧩 [LOD] added ${add.length} structural elements`);
      continue;
    }

    if (archFrac < targArchFrac) {
      // add short wall segments along bbox edges to boost ARCH
      const add:any[]=[];
      const seg = 2500; // Wall segment length in millimeters
      for (const s of (storeys?.length ? storeys : [{elevation:0}])) {
        const z = Number(s?.elevation||0); // Already in millimeters
        for (let x=bb.minX; x<bb.maxX; x+=seg) {
          add.push({
            id: uid("wall"),
            elementType: "WALL",
            properties: { start:{x, y:bb.minY}, end:{x:Math.min(x+seg,bb.maxX), y:bb.minY}, dimensions:{ width:200, height:3000 } },
            geometry: makeGeomBox({x:x+seg/2,y:bb.minY,z}, {w:seg,h:3000,d:200})
          });
        }
      }
      out = out.concat(add);
      console.log(`🧩 [LOD] added ${add.length} architectural elements`);
      continue;
    }

    if (gridFrac < maxGridFrac) {
      // add MEP grids
      const targetAdd = Math.min(1500, maxN - out.length);
      const f = Math.max(0.6, Math.min(1.5, Math.sqrt(targetAdd/1500)));
      // add MEP grids ONLY if spacing is provided from Claude's analysis
      const lightSpacing = options.spacing?.light ? options.spacing.light / Math.sqrt(options.density?.light || 1) / f : undefined;
      const sprinklerSpacing = options.spacing?.sprinkler ? options.spacing.sprinkler / Math.sqrt(options.density?.sprinkler || 1) / f : undefined;
      const receptacleSpacing = options.spacing?.receptacle ? options.spacing.receptacle / Math.sqrt(options.density?.receptacle || 1) / f : undefined;
      
      const lights     = addMEPGrid("LIGHT",     footprintPoly, storeys, bb, lightSpacing);
      const sprinklers = addMEPGrid("SPRINKLER", footprintPoly, storeys, bb, sprinklerSpacing);
      const recepts    = addMEPGrid("RECEPTACLE",footprintPoly, storeys, bb, receptacleSpacing);
      out = out.concat(lights, sprinklers, recepts);
      console.log(`🧩 [LOD] added MEP grids: ${lights.length} lights, ${sprinklers.length} sprinklers, ${recepts.length} receptacles`);
      continue;
    }

    // Nothing more to add under constraints
    break;
  }

  if (out.length > maxN) {
    console.log(`🧩 [LOD] truncating ${out.length} → ${maxN}`);
    out = out.slice(0, maxN);
  }
  
  console.log(`🧩 [LOD] final result: ${out.length} elements (added ${out.length - base.length})`);
  return { elements: out, added: out.length - base.length };
}

// 🚀 SIMPLE LOD EXPANSION INTERFACE for floor-by-floor generation
export async function expandLOD(baseElements: any[], lodProfile: any, options: any): Promise<any[]> {
  try {
    console.log(`🚀 [expandLOD] Starting expansion: ${baseElements.length} base → target ${lodProfile.maxElements}`);
    console.log(`⚠️ [expandLOD] Floor elevation passed: ${options.floorElevation}mm`);
    
    // Keep elevation in millimeters as provided from Claude's analysis
    const floorElevation = options.floorElevation || 0;
    
    // Base elements should already have Z coordinates in millimeters
    const storeys = [{ name: options.floorName || "Floor", elevation: floorElevation }];
    
    const result = expandWithLod({
      base: baseElements,
      storeys,
      options: {
        families: lodProfile.familyWeights || { structBias: 1.2, archBias: 1.2, mepBias: 1.0 },
        includeMechanical: lodProfile.includeMechanical || true,
        includeElectrical: lodProfile.includeElectrical || true,
        includePlumbing: lodProfile.includePlumbing || true,
        elementSplitting: lodProfile.elementSplitting || true,
        segmentWallsAtOpenings: lodProfile.segmentWalls || true,
        maxElements: lodProfile.maxElements,
        lod: lodProfile.name || "detailed",
        density: options.density || undefined, // Only from Claude's analysis
        spacing: options.spacing || undefined, // Only from Claude's analysis,
        minStructuralFraction: 0.25,
        targetArchitecturalFraction: 0.30,
        maxGridFraction: 0.45
      },
      footprint: { polygon: null }
    });
    
    const expandedElements = result.elements || result;
    console.log(`🚀 [expandLOD] Expansion complete: ${baseElements.length} → ${expandedElements.length} elements`);
    return expandedElements;
    
  } catch (error) {
    console.error(`❌ [expandLOD] Expansion failed:`, error);
    return baseElements; // Fallback to base elements
  }
}