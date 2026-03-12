// server/helpers/structural-seed.ts
// Guarantee a structural/architectural BASE when AI extraction yields 0.
// Builds perimeter walls from footprint polygon, a floor slab per storey,
// and columns at grid intersections if a grid is available.

type Pt = { x:number; y:number };
type Storey = { name?:string; elevation?:number };

function edgeYaw(a:Pt, b:Pt){
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.atan2(dy, dx); // radians, plan yaw
}

export async function seedStructuralFromAnalysis(args:{
  analysis?: any;             // Claude result (may be partial)
  footprint?: { polygon?: Pt[] | null; width?: number; length?: number; origin?: {x:number;y:number} | null } | null;
  storeys?: Storey[];
  defaults?: { wallThk?: number; wallH?: number; colSize?: number; slabThk?: number };
}) {
  const out:any[] = [];
  const storeys = (args.storeys && args.storeys.length) ? args.storeys : [{ name:"Ground Floor", elevation: 0 }];
  const fp = args.footprint || args.analysis?.footprint || args.analysis?.perimeter || null;

  const wallThk = Number(args.defaults?.wallThk ?? 0.2);     // 200mm
  const wallH   = Number(args.defaults?.wallH   ?? 3.0);     // 3m floor-to-floor
  const colSize = Number(args.defaults?.colSize ?? 0.4);     // 400mm
  const slabThk = Number(args.defaults?.slabThk ?? 0.2);     // 200mm

  // 1) Perimeter walls from polygon
  const poly: Pt[] | null = (fp?.polygon && fp.polygon.length>=3) ? fp.polygon : null;
  if (poly){
    for (const s of storeys){
      for (let i=0;i<poly.length;i++){
        const a = poly[i], b = poly[(i+1)%poly.length];
        const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
        const yaw = edgeYaw(a,b);
        const len = Math.hypot(b.x-a.x, b.y-a.y);
        out.push({
          id: `WALL_PERIM_${i}_${s.name||s.elevation}`,
          type: "WALL",
          geometry: {
            location: { realLocation: { x: mid.x, y: mid.y, z: s.elevation ?? 0 } },
            dimensions: {
              // orient major length along width or depth depending on yaw; viewer will render a box
              width: len,
              height: wallH,
              depth: wallThk
            },
            orientation: { yawRad: yaw }
          },
          storey: { name: s.name || `Z${s.elevation ?? 0}`, elevation: s.elevation ?? 0 },
          properties: { seeded: true, provenance: "structural-seed", note: "perimeter wall" }
        });
      }
    }
  }

  // 2) Slab per storey (rectangle fallback if no polygon)
  const bbox = (() => {
    if (poly){
      const xs = poly.map(p=>p.x), ys = poly.map(p=>p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    if (fp?.width && fp?.length){
      const ox = fp?.origin?.x ?? 0, oy = fp?.origin?.y ?? 0;
      return { minX: ox, minY: oy, maxX: ox + fp.width, maxY: oy + fp.length };
    }
    return null;
  })();

  if (bbox){
    const cx = (bbox.minX + bbox.maxX)/2, cy = (bbox.minY + bbox.maxY)/2;
    const w = Math.max(2, bbox.maxX - bbox.minX), d = Math.max(2, bbox.maxY - bbox.minY);
    for (const s of storeys){
      out.push({
        id: `SLAB_${s.name||s.elevation}`,
        type: "SLAB",
        geometry: {
          location: { realLocation: { x: cx, y: cy, z: (s.elevation ?? 0) - slabThk } },
          dimensions: { width: w, height: slabThk, depth: d },
          orientation: { yawRad: 0 }
        },
        storey: { name: s.name || `Z${s.elevation ?? 0}`, elevation: s.elevation ?? 0 },
        properties: { seeded: true, provenance: "structural-seed", note: "floor slab" }
      });
    }
  }

  // 3) Columns at grid intersections — prefer DETECTED grid nodes over Claude analysis
  let gridNodes: Array<{ x: number; y: number; label: string | null }> | null = null;
  try {
    const { getGridIntersectionNodes } = await import('../services/grid-integration-bridge');
    // analysis may carry projectId from upstream
    const pid = (args.analysis as any)?.projectId;
    if (pid) {
      gridNodes = await getGridIntersectionNodes(pid);
    }
  } catch { /* bridge not available */ }

  if (gridNodes && gridNodes.length > 0) {
    // Use real detected intersection nodes for column placement
    for (const s of storeys) {
      for (const node of gridNodes) {
        out.push({
          id: `COLUMN_${node.label || `${node.x.toFixed(0)}_${node.y.toFixed(0)}`}_${s.name || s.elevation}`,
          type: "COLUMN",
          geometry: {
            location: { realLocation: { x: node.x, y: node.y, z: s.elevation ?? 0 } },
            dimensions: { width: colSize, height: wallH, depth: colSize },
            orientation: { yawRad: 0 }
          },
          storey: { name: s.name || `Z${s.elevation ?? 0}`, elevation: s.elevation ?? 0 },
          properties: { seeded: true, provenance: "structural-seed", note: "detected grid intersection column", gridRef: node.label }
        });
      }
    }
  } else {
    // Fall back to Claude analysis gridSystem
    const grids = Array.isArray(args.analysis?.gridSystem) ? args.analysis.gridSystem : [];
    const gx = grids.filter((g:any)=> /X|EAST|WEST|VERT/i.test(String(g?.orientation||"")));
    const gy = grids.filter((g:any)=> /Y|NORTH|SOUTH|HORIZ/i.test(String(g?.orientation||"")));
    if (gx.length && gy.length){
      for (const s of storeys){
        for (const xg of gx){
          for (const yg of gy){
            if (!Number.isFinite(xg.x) || !Number.isFinite(yg.y)) continue;
            out.push({
              id: `COLUMN_${xg.name||xg.x}_${yg.name||yg.y}_${s.name||s.elevation}`,
              type: "COLUMN",
              geometry: {
                location: { realLocation: { x: Number(xg.x), y: Number(yg.y), z: s.elevation ?? 0 } },
                dimensions: { width: colSize, height: wallH, depth: colSize },
                orientation: { yawRad: 0 }
              },
              storey: { name: s.name || `Z${s.elevation ?? 0}`, elevation: s.elevation ?? 0 },
              properties: { seeded: true, provenance: "structural-seed", note: "grid intersection column (Claude fallback)" }
            });
          }
        }
      }
    }
  }

  return out;
}