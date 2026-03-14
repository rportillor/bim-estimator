// server/helpers/quantity-derive.ts
import { toPt } from "./polygon-utils";

const PI = Math.PI;
const mm = (m: number) => Math.round(m * 1000);

type Qto = {
  length_m?: number;
  area_m2?: number;
  volume_m3?: number;
  crossSection_m2?: number;
  diameter_m?: number;     // for circular
  width_m?: number;        // rectangular section
  depth_m?: number;
  height_m?: number;
  thickness_m?: number;
  thickness_mm?: number;
  trade?: "architectural" | "structural" | "mechanical" | "electrical" | "plumbing" | "fire";
};

function classifyTrade(t: string): Qto["trade"] {
  const T = t.toUpperCase();
  if (/DUCT|HVAC|VAV|MECH|EXHAUST|SUPPLY|RETURN/.test(T)) return "mechanical";
  if (/PIPE|PLUMBING|RISER|SPRINKLER|VENT|WASTE/.test(T)) return "plumbing";
  if (/PANEL|ELECTRICAL|CONDUIT|TRAY|CABLE|LIGHT|FIXTURE|RECEPTACLE|SWITCH/.test(T)) return "electrical";
  if (/BEAM|SLAB|COLUMN|FOUNDATION|FOOTING|PILE/.test(T)) return "structural";
  if (/WALL|DOOR|WINDOW|FACADE/.test(T)) return "architectural";
  return "architectural";
}

function pathLength(vertices: any[]): number {
  if (!Array.isArray(vertices) || vertices.length < 2) return 0;
  let L = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = toPt(vertices[i]);
    const b = toPt(vertices[i + 1]);
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

export function deriveQuantitiesForElements(elements: any[]) {
  const out: any[] = [];
  for (const e of elements || []) {
    const tname = String(e?.type || e?.category || "");
    const trade = classifyTrade(tname);
    const dims = (e?.geometry?.dimensions ?? {}) as any;
    const width  = Number(dims.width  ?? 0) || 0; // long axis after calibration for linear elements
    const height = Number(dims.height ?? 0) || 0;
    const depth  = Number(dims.depth  ?? 0) || 0;

    const verts = (e?.geometry?.vertices ?? []) as any[];
    const lengthFromPath = pathLength(verts);

    // Defaults
    let q: Qto = { trade };

    const T = tname.toUpperCase();

    // Linear architectural/structural (walls, beams, lintels)
    if (/WALL|BEAM|LINTEL|HEADER/.test(T)) {
      const length_m = lengthFromPath > 0 ? lengthFromPath : width;
      const thickness_m = Number(e?.properties?.thickness_m ?? Math.min(width, depth));
      const area_m2 = length_m * Math.max(0, height);
      const volume_m3 = area_m2 * Math.max(0, thickness_m);
      q = { ...q, length_m, height_m: height, thickness_m, thickness_mm: mm(thickness_m), area_m2, volume_m3 };
      // backfill thickness if missing
      e.properties = e.properties || {};
      if (e.properties.thickness_m == null) e.properties.thickness_m = thickness_m;
      if (e.properties.thickness_mm == null) e.properties.thickness_mm = mm(thickness_m);
    }
    // Slabs / floors (plan solids)
    else if (/SLAB|FLOOR/.test(T)) {
      const area_m2 = Math.max(0, width * depth);
      const thickness_m = height; // use height as thickness for slabs
      const volume_m3 = area_m2 * Math.max(0, thickness_m);
      q = { ...q, area_m2, thickness_m, thickness_mm: mm(thickness_m), volume_m3 };
      e.properties = e.properties || {};
      if (e.properties.thickness_m == null) e.properties.thickness_m = thickness_m;
      if (e.properties.thickness_mm == null) e.properties.thickness_mm = mm(thickness_m);
    }
    // Columns (rectangular assumed)
    else if (/COLUMN/.test(T)) {
      const area_m2 = Math.max(0, width * depth);
      const volume_m3 = area_m2 * Math.max(0, height);
      q = { ...q, width_m: width, depth_m: depth, height_m: height, area_m2, volume_m3 };
    }
    // Mechanical: ducts (rect or round)
    else if (/DUCT|VAV|HVAC|EXHAUST|SUPPLY|RETURN/.test(T)) {
      const length_m = lengthFromPath > 0 ? lengthFromPath : width; // prefer path
      let crossSection_m2 = 0, diameter_m = 0;
      // round if width≈depth
      if (Math.abs(width - depth) / Math.max(0.001, Math.max(width, depth)) <= 0.1) {
        diameter_m = (width + depth) / 2;
        crossSection_m2 = PI * Math.pow(diameter_m / 2, 2);
      } else {
        crossSection_m2 = Math.max(0, width * depth);
      }
      const volume_m3 = crossSection_m2 * Math.max(0, length_m);
      q = { ...q, length_m, width_m: width, depth_m: depth, diameter_m, crossSection_m2, volume_m3, trade: "mechanical" };
    }
    // Plumbing: pipes (mostly round)
    else if (/PIPE|PLUMBING|SPRINKLER|RISER|VENT|WASTE/.test(T)) {
      const length_m = lengthFromPath > 0 ? lengthFromPath : width;
      const diameter_m = (width + depth) / 2;
      const crossSection_m2 = PI * Math.pow(diameter_m / 2, 2);
      const volume_m3 = crossSection_m2 * Math.max(0, length_m);
      q = { ...q, length_m, diameter_m, crossSection_m2, volume_m3, trade: "plumbing" };
    }
    // Electrical: trays & conduits (rect vs round), fixtures/panels as counts
    else if (/TRAY|CONDUIT|CABLE/.test(T)) {
      const length_m = lengthFromPath > 0 ? lengthFromPath : width;
      let crossSection_m2 = 0, diameter_m = 0;
      if (/CONDUIT/.test(T)) {
        diameter_m = (width + depth) / 2;
        crossSection_m2 = PI * Math.pow(diameter_m / 2, 2);
      } else {
        crossSection_m2 = Math.max(0, width * depth);
      }
      const volume_m3 = crossSection_m2 * Math.max(0, length_m);
      q = { ...q, length_m, width_m: width, depth_m: depth, diameter_m, crossSection_m2, volume_m3, trade: "electrical" };
    }
    else if (/PANEL|SWITCHGEAR|FIXTURE|LIGHT|RECEPTACLE|SWITCH/.test(T)) {
      q = { ...q, area_m2: 0, volume_m3: 0, height_m: height, trade: "electrical" };
      e.properties = e.properties || {};
      e.properties.count = (e.properties.count ?? 0) + 1;
    }
    // Fallback (treat as prismatic solid)
    else {
      const area_m2 = Math.max(0, width * depth);
      const volume_m3 = area_m2 * Math.max(0, height);
      q = { ...q, width_m: width, depth_m: depth, height_m: height, area_m2, volume_m3 };
    }

    e.quantities = { ...(e.quantities || {}), ...q };
    out.push(e);
  }

  // Optional: quick summary if you want to attach to model
  const stats = {
    count: out.length,
    sums: out.reduce((acc, el) => {
      const q = el.quantities || {};
      acc.length_m   += Number(q.length_m   || 0);
      acc.area_m2    += Number(q.area_m2    || 0);
      acc.volume_m3  += Number(q.volume_m3  || 0);
      return acc;
    }, { length_m: 0, area_m2: 0, volume_m3: 0 })
  };

  return { elements: out, stats };
}