// server/helpers/grid-detect.ts
import { Pt } from "./geom-utils";

function cluster1D(values: number[], eps: number): number[] {
  const s = [...values].sort((a,b)=>a-b);
  const groups: number[][] = [];
  let cur: number[] = [];
  for (const v of s) {
    if (!cur.length || Math.abs(v - cur[cur.length-1]) <= eps) cur.push(v);
    else { groups.push(cur); cur = [v]; }
  }
  if (cur.length) groups.push(cur);
  return groups.map(g => g.reduce((a,b)=>a+b,0)/g.length);
}

/** Detect grid lines from structural elements (columns, walls start/end).
 * Returns { xs:number[], ys:number[] } */
export function detectGridFromElements(elements: any[]): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  for (const e of elements) {
    const t = String(e?.elementType || e?.type || "").toUpperCase();
    const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : e?.geometry || {};
    const p = g?.location?.realLocation || e?.location || { x: 0, y: 0, z: 0 };
    const d = g?.dimensions || e?.properties?.dimensions || {};
    // Use centers; walls contribute start/end if provided
    if (t.includes("WALL") && Array.isArray(g?.vertices) && g.vertices.length >= 2) {
      const a = g.vertices[0], b = g.vertices[g.vertices.length-1];
      xs.push(a.x, b.x); ys.push(a.y, b.y);
    } else {
      xs.push(+p.x || 0); ys.push(+p.y || 0);
    }
    // Column width/depth cue adds extra lines
    if (t.includes("COLUMN") && Number.isFinite(d?.width) && Number.isFinite(d?.depth)) {
      xs.push(p.x - d.width/2, p.x + d.width/2);
      ys.push(p.y - d.depth/2, p.y + d.depth/2);
    }
  }
  if (!xs.length || !ys.length) return { xs: [], ys: [] };

  // Epsilon ~ 1% of span (robust to unit scale)
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const epsX = Math.max(0.01 * (maxX - minX), 0.05);
  const epsY = Math.max(0.01 * (maxY - minY), 0.05);

  return { xs: cluster1D(xs, epsX), ys: cluster1D(ys, epsY) };
}