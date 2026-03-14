// server/services/grid-extractor.ts
// Extract non-uniform project grids + rotation hints from Claude analysis or PDF text.

type XY = { x:number; y:number };
type GridAxis = { name: string; pos: number };
type GridSet = { x: GridAxis[]; y: GridAxis[]; rotationDeg?: number };

function dedupSort(vals:number[], eps=1e-6){
  const s = [...vals].sort((a,b)=>a-b);
  const out:number[]=[];
  for (const v of s){ if (!out.length || Math.abs(out[out.length-1]-v)>eps) out.push(v); }
  return out;
}

function parseNumbersFromText(t:string){
  // pull common dimension strings: 3600, 3.6 m, 12', 12 ft, 3600mm etc.
  const out:number[]=[];
  const rx = /(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|')?/ig;
  let m:RegExpExecArray|null;
  while ((m = rx.exec(t))){
    const n = parseFloat(m[1]);
    const u = (m[2]||"").toLowerCase();
    let meters = n;
    if (u==="mm") meters = n/1000;
    else if (u==="cm") meters = n/100;
    else if (u==="ft" || u==="'") meters = n*0.3048;
    out.push(meters);
  }
  return out;
}

function toAxes(vals:number[], axisNames:string[]){
  const xs = dedupSort(vals);
  return xs.map((v,i)=>({ name: axisNames[i] || String(i+1), pos: v }));
}

export function buildNonUniformGridsFromAnalysis(analysis:any): GridSet | null {
  // Preferred structured path - prioritize structural grid for column placement
  const structuralGrid = analysis?.building_analysis?.structural_grid_system;
  const architecturalGrid = analysis?.building_analysis?.architectural_grid_system;
  const g = structuralGrid || architecturalGrid || analysis?.building_analysis?.grid_system || analysis?.grid_system;
  
  if (g?.x && g?.y) {
    const gx = (Array.isArray(g.x)?g.x:[]).map((it:any,i:number)=>({ name: String(it?.name ?? i+1), pos: Number(it?.pos ?? it) || 0 }));
    const gy = (Array.isArray(g.y)?g.y:[]).map((it:any,i:number)=>({ name: String(it?.name ?? i+1), pos: Number(it?.pos ?? it) || 0 }));
    const rotationDeg = Number(g.rotationDeg ?? analysis?.building_analysis?.rotation ?? 0);
    if (gx.length && gy.length) return { x: gx, y: gy, rotationDeg };
  }
  // Fallback: scrape text bundle (first 4–6 pages)
  const txt = String(analysis?.text_bundle || analysis?.raw_text || "");
  if (!txt) return null;

  // Heuristic: look for lines like "GRID A: 0, 3.6, 7.2, 10.8" etc.
  const lines = txt.split(/\n+/).slice(0, 400);
  const axisNamesX: string[] = [];
  const axisNamesY: string[] = [];
  const vx:number[]=[]; const vy:number[]=[];
  for (const L of lines) {
    const u = L.toUpperCase();
    if (/GRID[^A-Z0-9]*(A|X|EAST|HORIZ)/.test(u)) { vx.push(...parseNumbersFromText(L)); }
    if (/GRID[^A-Z0-9]*(1|Y|NORTH|VERT)/.test(u)) { vy.push(...parseNumbersFromText(L)); }
    // collect possible names too (not critical)
    const nameMatch = u.match(/\bGRID\s+([A-Z0-9]+)\b/);
    if (nameMatch) {
      const nm = nameMatch[1];
      if (/[A-Z]/.test(nm)) axisNamesX.push(nm);
      else axisNamesY.push(nm);
    }
  }
  if (vx.length && vy.length) {
    return {
      x: toAxes(vx, axisNamesX),
      y: toAxes(vy, axisNamesY),
      rotationDeg: Number(analysis?.building_analysis?.rotation ?? 0)
    };
  }
  return null;
}

export function computePrimaryAngles(footprint: XY[] | null){
  // Estimate major direction angle from longest edge.
  if (!footprint || footprint.length<2) return { buildingDeg: 0, siteDeg: 0 };
  let bestLen = 0, bestAng = 0;
  for (let i=0;i<footprint.length;i++){
    const a = footprint[i], b = footprint[(i+1)%footprint.length];
    const dx = b.x-a.x, dy = b.y-a.y;
    const L = Math.hypot(dx,dy);
    if (L>bestLen){ bestLen=L; bestAng = Math.atan2(dy,dx); }
  }
  const buildingDeg = bestAng*180/Math.PI;
  return { buildingDeg, siteDeg: 0 };
}