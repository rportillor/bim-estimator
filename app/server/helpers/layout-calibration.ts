// server/helpers/layout-calibration.ts
// Hardened layout calibration: footprint fallback, unit scaling, de-dup positioning, and global transform.

import { convexHull } from "./geom-utils";

// Dynamic import helper for footprint-extractor service
async function tryFootprintService() {
  try {
    const svc = await import("../services/footprint-extractor");
    return svc;
  } catch {
    return null;
  }
}

type Pt = { x:number; y:number };
type P3 = { x:number; y:number; z:number };
type Storey = { name?: string; elevation?: number };

// Configuration values must come from Claude's analysis of construction documents
// No hardcoded defaults allowed - spacing should be extracted from actual drawings

function vadd(a:Pt,b:Pt):Pt{ return {x:a.x+b.x, y:a.y+b.y}; }
function vsub(a:Pt,b:Pt):Pt{ return {x:a.x-b.x, y:a.y-b.y}; }
function vscale(a:Pt,s:number):Pt{ return {x:a.x*s, y:a.y*s}; }
function len(a:Pt):number{ return Math.hypot(a.x,a.y); }
function bbox2d(points:Pt[]){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
  return {minX,minY,maxX,maxY,width:Math.max(0,maxX-minX),length:Math.max(0,maxY-minY)};
}
function clamp(n:number,lo:number,hi:number){ return Math.max(lo, Math.min(hi, n)); }

function edges(poly:Pt[]){ const out:{a:Pt,b:Pt}[]=[]; for(let i=0;i<poly.length;i++){ out.push({a:poly[i], b:poly[(i+1)%poly.length]}); } return out; }

function parseGeometry(e:any){
  const g = typeof e?.geometry === "string" ? safeJSON(e.geometry) : (e?.geometry||{});
  const dims = g?.dimensions || {};
  const loc = g?.location?.realLocation || e?.properties?.realLocation || {x:0,y:0,z:0};
  const yaw = g?.orientation?.yawRad ?? 0;
  return { g, dims, loc, yaw };
}
function safeJSON(s:string){ 
  try{ 
    if (!s || typeof s !== 'string') return {};
    return JSON.parse(s); 
  } catch { 
    return {}; 
  } 
}

function detectScale(elements:any[]):number{
  // Heuristic: use wall thickness / column size medians to infer units.
  const arr:number[]=[];
  for(const e of elements){
    const k = String(e?.elementType||e?.type||e?.category||"");
    if (!/(WALL|COLUMN|SLAB|FLOOR|FOUNDATION|BEAM)/i.test(k)) continue;
    const {dims} = parseGeometry(e);
    const w = Number(dims?.width ?? 0);
    const d = Number(dims?.depth ?? dims?.length ?? 0);
    if (w>0) arr.push(w);
    if (d>0) arr.push(d);
  }
  if (!arr.length) return 1;
  arr.sort((a,b)=>a-b);
  const m = arr[Math.floor(arr.length*0.5)];
  // If median thickness looks like millimeters (e.g. 200), scale to meters.
  if (m > 20 && m < 2000) return 0.001;           // mm → m
  // If median thickness looks like feet (e.g. 1.0–3.0), scale ft→m.
  if (m >= 0.9 && m <= 4.0) return 0.3048;        // ft → m
  // If median thickness is extremely tiny, assume inches → meters.
  if (m > 0.3 && m < 12 && m !== 1.0) return 0.0254; // in → m (rare)
  return 1; // looks metric already
}

function countByType(elements:any[]){
  const out:Record<string,number> = {};
  for(const e of elements){
    const k = String(e?.elementType||e?.type||e?.category||"UNKNOWN").toUpperCase();
    out[k] = (out[k]||0)+1;
  }
  return out;
}

// --- Footprint sources ------------------------------------------------------

async function tryEnsureFootprint(projectId:string, modelId:string):Promise<Pt[]|null>{
  // Use your existing services if present; fall back safely.
  try{
    const svc = await tryFootprintService();
    if (svc && typeof svc.ensureFootprintForModel === "function") {
      const r = await svc.ensureFootprintForModel({projectId, modelId});
      const poly = (r as any)?.building_footprint || (r as any)?.footprint || (r as any)?.perimeter;
      if (Array.isArray(poly) && poly.length>=3) return poly.map((p:any)=>({x:Number(p.x), y:Number(p.y)}));
    }
  }catch{}
  return null;
}
async function tryEnsurePropertyLine(projectId:string, modelId:string):Promise<Pt[]|null>{
  try{
    const svc = await tryFootprintService();
    if (svc && typeof svc.ensureFootprintForModel === "function") {
      const r = await svc.ensureFootprintForModel({projectId, modelId});
      const poly = (r as any)?.property_line;
      if (Array.isArray(poly) && poly.length>=3) return poly.map((p:any)=>({x:Number(p.x), y:Number(p.y)}));
    }
  }catch{}
  return null;
}

function inferFootprintFromElements(elements:any[]):Pt[]|null{
  const pts:Pt[]=[];
  for (const e of elements) {
    const {dims, loc} = parseGeometry(e);
    if (!Number.isFinite(loc.x) || !Number.isFinite(loc.y)) continue;
    const w = Number(dims?.width ?? 0.2), d = Number(dims?.depth ?? dims?.length ?? 0.2);
    const hw = clamp(w/2, 0.05, 5), hd = clamp(d/2, 0.05, 5);
    pts.push({x:loc.x-hw,y:loc.y-hd},{x:loc.x+hw,y:loc.y-hd},{x:loc.x+hw,y:loc.y+hd},{x:loc.x-hw,y:loc.y+hd});
  }
  if (pts.length < 3) return null;
  const hull = convexHull(pts);
  if (hull.length>=3) return hull;
  return null;
}

function synthesizeFootprintFromMEP(elements:any[]):Pt[] {
  // 🚨 CRITICAL ERROR: Should NEVER reach this fallback
  // Building footprint must come from construction drawings, not MEP fixture counts
  console.error(`❌ CRITICAL: synthesizeFootprintFromMEP should never be called`);
  console.error(`🏗️ Building dimensions must be extracted from Claude's analysis of construction documents`);
  console.error(`📋 Elements available: ${elements.length}, types: ${Object.keys(countByType(elements)).join(', ')}`);
  
  throw new Error(`Building footprint must be extracted from construction drawings, not estimated from MEP fixtures. This indicates Claude failed to analyze the building dimensions from the uploaded construction documents.`);
}

// --- Application of transform ----------------------------------------------

function applyScaleAndPosition(elements:any[], opts:{scale:number; yaw:number; translate:Pt; clampM:number; reCenter:boolean; flipZIfAllYNegative:boolean}){
  let ysNeg = 0, ysAll = 0;
  for (const e of elements) {
    const { g, dims, loc } = parseGeometry(e);
    const s = opts.scale;
    const yaw = opts.yaw;
    // rotate in XY-plane (plan)
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let x = Number(loc.x||0)*s, y = Number(loc.y||0)*s, z = Number(loc.z||0)*s;
    // flip if requested later
    ysAll++; if (y<0) ysNeg++;

    const rx = x*cos - y*sin;
    const ry = x*sin + y*cos;
    x = rx + opts.translate.x;
    y = ry + opts.translate.y;

    // clamp outliers to keep scene navigable
    if (opts.clampM > 0) {
      x = clamp(x, -opts.clampM, opts.clampM);
      y = clamp(y, -opts.clampM, opts.clampM);
      z = clamp(z, -opts.clampM, opts.clampM);
    }

    // scale dimensions
    const W = Math.max(0.01, Number(dims?.width ?? 1) * s);
    const H = Math.max(0.01, Number(dims?.height ?? 1) * s);
    const D = Math.max(0.01, Number(dims?.depth ?? dims?.length ?? 1) * s);

    g.dimensions = { width: W, height: H, depth: D };
    g.location = { ...(g.location||{}), realLocation: { x, y, z } };
    e.geometry = g;
  }

  if (opts.flipZIfAllYNegative && ysAll>10 && ysNeg/ysAll > 0.95) {
    // flip plan axis (common DWG vs viewer convention)
    for (const e of elements) {
      const { g } = parseGeometry(e);
      const p = g.location?.realLocation || {x:0,y:0,z:0};
      g.location.realLocation = { x: p.x, y: -p.y, z: p.z };
      e.geometry = g;
    }
  }
  return elements;
}

// Distribute identical XY points so they don't stack:
function spreadDuplicates(elements:any[], rect:Pt[]){
  const seen = new Map<string, number>();
  const edgesArr = edges(rect);
  let edgeIdx = 0, t = 0;

  for (const e of elements) {
    const { g } = parseGeometry(e);
    const p = g.location?.realLocation || {x:0,y:0,z:0};
    const key = `${p.x.toFixed(3)}|${p.y.toFixed(3)}|${(p.z||0).toFixed(3)}`;
    const count = (seen.get(key) || 0) + 1; seen.set(key, count);
    if (count === 1) continue; // unique, skip

    // move along perimeter a little for each duplicate
    const seg = edgesArr[edgeIdx % edgesArr.length];
    const dir = vsub(seg.b, seg.a); const L = Math.max(len(dir), 0.001);
    const u = vscale(dir, 1/L);
    const step = 0.6; // meters between duplicates
    const offset = step * (count-1);
    const q = vadd(seg.a, vscale(u, Math.min(L*0.9, offset)));
    g.location.realLocation = { x: q.x, y: q.y, z: p.z };
    e.geometry = g;

    if (offset >= L*0.9) { edgeIdx++; t = 0; } else { t += step; }
  }
  return elements;
}

// Tile MEP uniformly inside rect (when they collapsed to one point):
function tileMEPInside(elements:any[], rect:Pt[], spacingFromAnalysis?: {light?: number; sprinkler?: number}){
  const types = countByType(elements);
  const mep = elements.filter(e => /(LIGHT|SPRINKLER|RECEPTACLE|DUCT|PIPE|CONDUIT|DIFFUSER|PANEL|MECH)/i.test(String(e?.elementType||e?.type||e?.category||"")));
  if (!mep.length) return elements;

  // Only position MEP if we have actual spacing from Claude's analysis
  if (!spacingFromAnalysis?.light) {
    console.warn('⚠️ No lighting spacing found in Claude analysis - skipping MEP positioning');
    return elements;
  }

  const bb = bbox2d(rect);
  const W = bb.width;
  const L = bb.length;
  const lightSpacing = spacingFromAnalysis.light;
  const cols = Math.max(2, Math.round(W / lightSpacing));
  const rows = Math.max(2, Math.round(L / lightSpacing));
  const dx = W / (cols+1), dy = L / (rows+1);
  let i = 0;

  for (const e of mep) {
    const cx = bb.minX + dx * (1 + (i % cols));
    const cy = bb.minY + dy * (1 + Math.floor(i / cols) % rows);
    i++;
    const { g } = parseGeometry(e);
    const p = g.location?.realLocation || {x:0,y:0,z:0};
    g.location = { ...(g.location||{}), realLocation: { x: cx, y: cy, z: p.z } };
    e.geometry = g;
  }
  return elements;
}

function ensureMinSceneSize(elements:any[], rect:Pt[], minDiagFromAnalysis?: number){
  const bb = bbox2d(rect);
  const diag = Math.hypot(bb.width, bb.length);
  
  // Only scale if we have actual minimum dimensions from Claude's analysis
  if (!minDiagFromAnalysis || diag >= minDiagFromAnalysis) {
    return { elements, rect };
  }
  
  // scale up to minimum diagonal from analysis
  const s = minDiagFromAnalysis / Math.max(1e-6, diag);
  const c = { x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2 };
  for (const e of elements) {
    const { g } = parseGeometry(e);
    const p = g.location?.realLocation || {x:0,y:0,z:0};
    const vx = p.x - c.x, vy = p.y - c.y;
    g.location.realLocation = { x: c.x + vx*s, y: c.y + vy*s, z: p.z };
    // dimensions scale too
    const d = g.dimensions || {};
    g.dimensions = { width: (d.width||0.1)*s, height:(d.height||0.1), depth:(d.depth||d.length||0.1)*s };
    e.geometry = g;
  }
  // scale rect
  const rc = rect.map(p => ({ x: c.x + (p.x-c.x)*s, y: c.y + (p.y-c.y)*s }));
  return { elements, rect: rc };
}

// PUBLIC API ----------------------------------------------------------------

export async function calibrateAndPositionElements(
  projectId: string,
  modelId: string,
  elements: any[],
  opts: {
    // v15.13: "preferClaude" accepted — maps to "auto" (Claude footprint is tried first
    // via tryEnsureFootprint → footprint-extractor → anthropicClient when available).
    mode?: "auto" | "forcePerimeter" | "preferClaude";
    reCenterToOrigin?: boolean;
    flipZIfAllYNegative?: boolean;
    clampOutliersMeters?: number;
    spacingFromAnalysis?: {light?: number; sprinkler?: number};
    minDiagFromAnalysis?: number;
  } = {}
){
  // "preferClaude" uses the same footprint-priority chain as "auto"
  const mode = opts.mode === "preferClaude" ? "auto" : (opts.mode ?? "auto");

  // 0) Unit scale & sanitize positions
  const scale = detectScale(elements);
  console.log(`🧭 CALIBRATION: detected unit scale=${scale.toFixed(4)} for ${elements.length} elements`);
  // Use analysis yaw/translate if available later; for now yaw=0 and translate set after rect chosen.
  let yaw = 0;
  let translate: Pt = { x: 0, y: 0 };

  // Attempt footprints in descending priority
  let rect: Pt[] | null = null;

  // (a) building footprint (Claude/site-plan)
  const fp = await tryEnsureFootprint(projectId, modelId);
  if (fp && fp.length>=3) rect = fp;

  // (b) property line if allowed
  if (!rect) {
    const pl = await tryEnsurePropertyLine(projectId, modelId);
    if (pl && pl.length>=3) rect = pl;
  }

  // (c) element hull
  if (!rect) {
    const hull = inferFootprintFromElements(elements);
    if (hull && hull.length>=3) rect = hull;
  }

  // (d) Emergency unit-square fallback — never throw; callers handle raw coords.
  // Architecture: the geometry is still written to DB (with a warning); an RFI
  // for missing site drawings covers the gap. The 3D viewer will show a 1×1 box
  // until real drawings are uploaded and re-processed.
  if (!rect) {
    console.error(`❌ CALIBRATION: No footprint from any source — using 1×1 unit square placeholder`);
    console.error(`📋 Upload a site plan or floor plan that shows the building outline.`);
    // 1-metre square at origin — gives calibration a valid polygon to work with.
    // All element positions remain in their raw QTO coordinates (centred by reCenterToOrigin).
    rect = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  }

  // now we have some polygon (rect could be any polygon)
  const bb = bbox2d(rect);
  const center = { x:(bb.minX+bb.maxX)/2, y:(bb.minY+bb.maxY)/2 };

  // if requested, recenter entire scene so centroid ~ origin
  if (opts.reCenterToOrigin) translate = { x: -center.x, y: -center.y };

  // 🏗️ DETECT BUILDING ROTATION: Calculate from footprint's longest edge
  if (rect && rect.length >= 3) {
    let bestLen = 0, bestAngle = 0;
    for (let i = 0; i < rect.length; i++) {
      const a = rect[i];
      const b = rect[(i + 1) % rect.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > bestLen) {
        bestLen = length;
        bestAngle = Math.atan2(dy, dx);
      }
    }
    yaw = bestAngle; // Apply detected building rotation
    console.log(`🏗️ BUILDING ROTATION DETECTED: ${(bestAngle * 180 / Math.PI).toFixed(1)}° from footprint analysis`);
  }

  // 1) apply transform (scale, detected yaw rotation, translate, outlier clamp)
  let placed = applyScaleAndPosition(elements, {
    scale,
    yaw,  // ← NOW USING DETECTED BUILDING ROTATION!
    translate,
    clampM: opts.clampOutliersMeters || 0, // Only clamp if explicitly provided from analysis
    reCenter: !!opts.reCenterToOrigin,
    flipZIfAllYNegative: !!opts.flipZIfAllYNegative
  });

  // 2) de-duplicate & distribute stacked points
  placed = spreadDuplicates(placed, rect);

  // 3) if majority of MEP still clustered, tile them across interior
  placed = tileMEPInside(placed, rect, opts.spacingFromAnalysis);

  // 4) ensure we don't present a microscopic scene to the viewer
  const ensured = ensureMinSceneSize(placed, rect, opts.minDiagFromAnalysis);

  return ensured.elements;
}

// === DUAL-ROTATION CALIBRATION (Advanced) ===================================

type XY = { x:number; y:number };
type Transform = { scale:number; thetaSite:number; thetaBuilding:number; tx:number; ty:number };
type GridAxis = { name:string; pos:number };
type GridSet = { x: GridAxis[]; y: GridAxis[] };

function rad(d:number){ return d*Math.PI/180; }
function rot(p:XY, th:number):XY { const c=Math.cos(th), s=Math.sin(th); return { x: c*p.x - s*p.y, y: s*p.x + c*p.y }; }

function centroid(poly:XY[]){
  let A=0, cx=0, cy=0;
  for (let i=0;i<poly.length;i++){
    const p=poly[i], q=poly[(i+1)%poly.length];
    const cross = p.x*q.y - q.x*p.y;
    A += cross; cx += (p.x+q.x)*cross; cy += (p.y+q.y)*cross;
  }
  A *= 0.5; if (Math.abs(A)<1e-9) return { x:0, y:0 };
  return { x: cx/(6*A), y: cy/(6*A) };
}

export function computeDualRotationTransform(args:{
  propertyLine?: XY[] | null;
  footprint?: XY[] | null;
  siteRotationDeg?: number;       // optional hint
  buildingRotationDeg?: number;   // optional hint
  targetOrigin?: XY;              // where to place model origin after calibration
  unitScale?: number;             // scale factor to convert to meters if needed
}): Transform {
  const unitScale = Number(args.unitScale ?? 1);
  const siteDeg   = Number(args.siteRotationDeg ?? 0);
  // If no explicit building angle, derive from footprint longest edge
  let buildingDeg = Number(args.buildingRotationDeg ?? 0);
  if ((args.footprint?.length ?? 0) >= 3 && !args.buildingRotationDeg) {
    let bestLen=0, bestAng=0;
    for (let i=0;i<(args.footprint!.length);i++){
      const a=args.footprint![i], b=args.footprint![(i+1)%args.footprint!.length];
      const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy);
      if (L>bestLen){ bestLen=L; bestAng=Math.atan2(dy,dx); }
    }
    buildingDeg = bestAng*180/Math.PI;
  }
  const thetaSite = rad(siteDeg);
  const thetaBuilding = rad(buildingDeg);
  const target = args.targetOrigin ?? { x: 0, y: 0 };

  // Position: move footprint centroid to target after rotations
  let tx=0, ty=0;
  if (args.footprint?.length) {
    const c = centroid(args.footprint);
    const afterSite = rot({ x:c.x*unitScale, y:c.y*unitScale }, thetaSite);
    const afterBoth = rot(afterSite, thetaBuilding);
    tx = target.x - afterBoth.x; ty = target.y - afterBoth.y;
  }
  return { scale: unitScale, thetaSite, thetaBuilding, tx, ty };
}

export function applyTransform(e:any, T:Transform){
  const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : (e.geometry ||= {});
  const p = g?.location?.realLocation || { x:0,y:0,z:0 };
  const pt = { x: p.x*T.scale, y: p.y*T.scale };
  const p1 = rot(pt, T.thetaSite);
  const p2 = rot(p1, T.thetaBuilding);
  const x = p2.x + T.tx, y = p2.y + T.ty;
  const z = Number(p.z||0);
  e.geometry = { ...(g||{}), location: { realLocation: { x, y, z } } };
  return e;
}

export function snapToNonUniformGrid(e:any, grids:GridSet, tol=0.12){
  const g = typeof e?.geometry==="string" ? JSON.parse(e.geometry) : e?.geometry;
  const p = g?.location?.realLocation; if (!p) return e;
  const snap = (v:number, axis:GridAxis[])=>{
    let best=v, dmin=Infinity;
    for (const a of axis){ const d = Math.abs(v - a.pos); if (d<dmin){ dmin=d; best=a.pos; } }
    return dmin<=tol ? best : v;
  };
  const nx = grids?.x?.length ? snap(p.x, grids.x) : p.x;
  const ny = grids?.y?.length ? snap(p.y, grids.y) : p.y;
  if (nx!==p.x || ny!==p.y){
    e.geometry = { ...(g||{}), location: { realLocation: { x: nx, y: ny, z: p.z } } };
  }
  return e;
}