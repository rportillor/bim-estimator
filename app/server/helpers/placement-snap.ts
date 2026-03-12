// server/helpers/placement-snap.ts
const EPS = 1e-3;

export function snapToGrid(
  p: {x:number;y:number;z:number},
  grid?: { x?: number[]; y?: number[] },
  tol = 0.25  // meters
) {
  if (!grid) return p;
  let { x, y } = p;

  if (Array.isArray(grid.x) && grid.x.length) {
    let bestDx = Infinity, bestX = x;
    for (const gx of grid.x) {
      const dx = Math.abs(gx - x);
      if (dx < bestDx) { bestDx = dx; bestX = gx; }
    }
    if (bestDx <= tol) x = bestX;
  }
  if (Array.isArray(grid.y) && grid.y.length) {
    let bestDy = Infinity, bestY = y;
    for (const gy of grid.y) {
      const dy = Math.abs(gy - y);
      if (dy < bestDy) { bestDy = dy; bestY = gy; }
    }
    if (bestDy <= tol) y = bestY;
  }
  return { ...p, x, y };
}

export function clampToFootprint(
  p: {x:number;y:number;z:number},
  footprint?: Array<{x:number;y:number}>
) {
  if (!Array.isArray(footprint) || footprint.length < 3) return p;

  // Quick acceptance test: inside polygon?
  if (pointInPolygon([p.x, p.y], footprint.map(q=>[q.x,q.y] as [number,number]))) return p;

  // Project to nearest edge
  let best = { x: p.x, y: p.y }, bestDist = Infinity;
  for (let i=0; i<footprint.length; i++) {
    const a = footprint[i], b = footprint[(i+1)%footprint.length];
    const proj = projectPointToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    const dx = proj.x - p.x, dy = proj.y - p.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestDist) { bestDist = d2; best = proj; }
  }
  return { ...p, x: best.x, y: best.y };
}

function pointInPolygon(pt:[number,number], poly:[number,number][]) {
  let c = false;
  for (let i=0,j=poly.length-1; i<poly.length; j=i++) {
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    const intersect=((yi>pt[1]) !== (yj>pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || EPS) + xi);
    if (intersect) c = !c;
  }
  return c;
}
function projectPointToSegment(px:number,py:number, ax:number,ay:number, bx:number,by:number){
  const vx = bx-ax, vy=by-ay;
  const wx = px-ax, wy=py-ay;
  const vv = vx*vx + vy*vy || EPS;
  let t = (vx*wx + vy*wy)/vv; t = Math.max(0, Math.min(1, t));
  return { x: ax + t*vx, y: ay + t*vy };
}