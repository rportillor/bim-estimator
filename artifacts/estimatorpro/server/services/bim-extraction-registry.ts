/**
 * BIM Extraction Registry — Comprehensive Claude Vision extraction for ALL
 * construction element types found in architectural, structural, and MEP drawings.
 *
 * Each entry in ELEMENT_REGISTRY defines:
 *   prompt     — What Claude should look for and how to describe it
 *   parseRaw   — Convert Claude's text response into typed JS objects
 *   toDbRecord — Convert a typed object into the geometry/properties JSON for the DB
 *
 * The single entry point `extractElementType()` handles the full pipeline:
 *   PDF → Claude Vision → validate → DB insert
 *
 * Supported categories:
 *   Structural  : slab, exterior_wall, interior_wall, column, beam, stair, ramp, foundation
 *   Envelope    : window, door, curtain_wall, skylight
 *   Finishes    : floor_finish, ceiling, counter, millwork
 *   Plumbing    : toilet, sink, bathtub, shower, urinal, floor_drain, water_heater
 *   HVAC        : hvac_unit, exhaust_fan, diffuser, radiator
 *   Electrical  : light_fixture, electrical_outlet, electrical_panel, switch, emergency_light
 *   Fire/Safety : sprinkler_head, fire_extinguisher, standpipe, fire_alarm
 *   Parking     : parking_stall, parking_sign
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { pool } from "../db";

// ─── Shared grid geometry (matches moorings-grid-constants.ts) ────────────────

const WING_ANG = 27.16;

const GRIDLINES = [
  { label:"A",  axis:"X",coord:0,      s:0,      e:40.830,a:0 },
  { label:"B",  axis:"X",coord:4.710,  s:0,      e:40.830,a:0 },
  { label:"C",  axis:"X",coord:8.199,  s:0,      e:40.830,a:0 },
  { label:"D",  axis:"X",coord:12.553, s:0,      e:40.830,a:0 },
  { label:"E",  axis:"X",coord:15.099, s:0,      e:40.830,a:0 },
  { label:"F",  axis:"X",coord:19.149, s:0,      e:40.830,a:0 },
  { label:"G",  axis:"X",coord:21.450, s:0,      e:40.830,a:0 },
  { label:"Ga", axis:"X",coord:22.199, s:0,      e:40.830,a:0 },
  { label:"H",  axis:"X",coord:29.049, s:0,      e:40.830,a:0 },
  { label:"J",  axis:"X",coord:32.100, s:0,      e:40.830,a:0 },
  { label:"K",  axis:"X",coord:38.949, s:0,      e:40.830,a:0 },
  { label:"L",  axis:"X",coord:41.999, s:0,      e:40.830,a:0 },
  { label:"CLa",axis:"X",coord:40.525, s:0,      e:40.830,a:13.58 },
  { label:"CL", axis:"X",coord:43.810, s:0,      e:40.830,a:13.58 },
  { label:"CLb",axis:"X",coord:47.095, s:0,      e:40.830,a:13.58 },
  { label:"M",  axis:"X",coord:45.671, s:-0.756, e:35.572,a:WING_ANG },
  { label:"N",  axis:"X",coord:49.054, s:-2.130, e:34.198,a:WING_ANG },
  { label:"P",  axis:"X",coord:50.956, s:-2.903, e:33.425,a:WING_ANG },
  { label:"Q",  axis:"X",coord:55.371, s:-4.696, e:31.632,a:WING_ANG },
  { label:"R",  axis:"X",coord:58.551, s:-5.987, e:30.341,a:WING_ANG },
  { label:"S",  axis:"X",coord:65.272, s:-8.717, e:27.611,a:WING_ANG },
  { label:"Sa", axis:"X",coord:66.021, s:-9.021, e:27.307,a:WING_ANG },
  { label:"T",  axis:"X",coord:68.322, s:-9.956, e:26.372,a:WING_ANG },
  { label:"U",  axis:"X",coord:72.372, s:-11.600,e:24.728,a:WING_ANG },
  { label:"V",  axis:"X",coord:74.918, s:-12.635,e:23.693,a:WING_ANG },
  { label:"W",  axis:"X",coord:79.272, s:-14.403,e:21.925,a:WING_ANG },
  { label:"X",  axis:"X",coord:82.761, s:-15.820,e:20.508,a:WING_ANG },
  { label:"Y",  axis:"X",coord:87.472, s:-17.733,e:18.595,a:WING_ANG },
  { label:"9",  axis:"Y",coord:0,      s:0,      e:41.999,a:0 },
  { label:"8",  axis:"Y",coord:5.885,  s:0,      e:41.999,a:0 },
  { label:"7",  axis:"Y",coord:8.244,  s:0,      e:41.999,a:0 },
  { label:"6",  axis:"Y",coord:14.850, s:0,      e:41.999,a:0 },
  { label:"5",  axis:"Y",coord:21.830, s:0,      e:41.999,a:0 },
  { label:"4",  axis:"Y",coord:26.030, s:0,      e:41.999,a:0 },
  { label:"3",  axis:"Y",coord:27.876, s:0,      e:41.999,a:0 },
  { label:"2",  axis:"Y",coord:37.355, s:0,      e:41.999,a:0 },
  { label:"1",  axis:"Y",coord:40.830, s:0,      e:41.999,a:0 },
  { label:"10", axis:"Y",coord:35.572, s:63.921, e:97.012,a:WING_ANG },
  { label:"11", axis:"Y",coord:32.480, s:62.335, e:95.426,a:WING_ANG },
  { label:"12", axis:"Y",coord:28.254, s:60.167, e:93.258,a:WING_ANG },
  { label:"13", axis:"Y",coord:24.046, s:58.008, e:91.099,a:WING_ANG },
  { label:"14", axis:"Y",coord:22.404, s:57.165, e:90.256,a:WING_ANG },
  { label:"15", axis:"Y",coord:18.667, s:55.248, e:88.339,a:WING_ANG },
  { label:"16", axis:"Y",coord:12.457, s:52.062, e:85.153,a:WING_ANG },
  { label:"17", axis:"Y",coord:6.579,  s:49.046, e:82.137,a:WING_ANG },
  { label:"18", axis:"Y",coord:4.480,  s:47.970, e:81.060,a:WING_ANG },
  { label:"19", axis:"Y",coord:-0.756, s:45.283, e:78.374,a:WING_ANG },
] as const;

export function resolveGridIntersection(alpha: string, numeric: string): { ew: number; ns: number } | null {
  const al = alpha.trim().toUpperCase();
  const nl = numeric.trim().toUpperCase();
  const a = (GRIDLINES as any[]).find(g => g.axis === "X" && g.label.toUpperCase() === al);
  const n = (GRIDLINES as any[]).find(g => g.axis === "Y" && g.label.toUpperCase() === nl);
  if (!a || !n) return null;
  const tanA = Math.tan(a.a * Math.PI / 180);
  const tanN = Math.tan(n.a * Math.PI / 180);
  const denom = 1 + tanA * tanN;
  if (Math.abs(denom) < 1e-10) return null;
  const ns = (n.coord + (n.s - a.coord) * tanN) / denom;
  return { ew: a.coord + ns * tanA, ns };
}

export function parseGridRef(ref: string): { ew: number; ns: number } | null {
  const m = ref.trim().match(/^([A-Za-z]+[a-z]?)\s*[×x×\-\/\s]\s*(\d+)$/i);
  if (!m) return null;
  return resolveGridIntersection(m[1], m[2]);
}

const ENVELOPE = { minEW: -3, maxEW: 102, minNS: -22, maxNS: 44 };
export function inEnvelope(ew: number, ns: number) {
  return ew >= ENVELOPE.minEW && ew <= ENVELOPE.maxEW && ns >= ENVELOPE.minNS && ns <= ENVELOPE.maxNS;
}

// ─── Shared prompt header ─────────────────────────────────────────────────────

const GRID_HEADER = `GRID COORDINATE SYSTEM for The Moorings, Cameron Lake ON (drawing A101+):
Rectangular block (angle 0°):
  EW grids: A=0, B=4.71, C=8.20, D=12.55, E=15.10, F=19.15, G=21.45, Ga=22.20,
            H=29.05, J=32.10, K=38.95, L=42.00  (run N-S)
  NS grids: 9=0, 8=5.89, 7=8.24, 6=14.85, 5=21.83, 4=26.03, 3=27.88, 2=37.36, 1=40.83 (run E-W)
Angled wing (27.16° offset):
  EW: M, N, P, Q, R, S, T, U, V, W, X, Y  |  NS: 10–19
Express positions as "ALPHA × NUMERIC" e.g. "C × 7" or as offset from grid in metres.`;

// ─── Registry definition ──────────────────────────────────────────────────────

export interface ElementRecord {
  element_id:   string;
  element_type: string;
  storey_name:  string;
  geometry:     Record<string, unknown>;
  properties:   Record<string, unknown>;
}

export interface RegistryEntry {
  label:      string;   // human-readable name
  category:   string;   // structural | envelope | finishes | plumbing | hvac | electrical | fire | parking
  prompt:     (storey: string, floorElev: number) => string;
  parseRaw:   (raw: string) => any[];
  toDbRecord: (item: any, idx: number, storey: string, floorElev: number) => ElementRecord | null;
}

// ─── Generic position-based element factory ───────────────────────────────────
// Many element types are just "a box at a position"; only the prompt and dims differ.
// This factory avoids repeating the same parsing/DB logic for every fixture type.

function makeFixtureEntry(opts: {
  label:    string;
  category: string;
  dbType:   string;
  description: string;
  symbolHint:  string;
  defaultDims: { w: number; d: number; h: number };
  extraPromptLines?: string;
}): RegistryEntry {
  return {
    label:    opts.label,
    category: opts.category,
    prompt: (storey, floorElev) => `You are reading a construction drawing for The Moorings, Cameron Lake ON.
${GRID_HEADER}
Floor elevation: ${floorElev} m  |  Storey: ${storey}

TASK: Identify every ${opts.label} (${opts.description}) visible on this plan.
Look for: ${opts.symbolHint}
${opts.extraPromptLines ?? ""}
Default dimensions if not labelled: ${opts.defaultDims.w}m wide × ${opts.defaultDims.d}m deep × ${opts.defaultDims.h}m high.

For each item return:
  grid_ref   — nearest grid intersection ("ALPHA × NUMERIC") OR alpha grid + offset in metres
  offset_ew  — east-west offset in metres from that grid (0 if on grid)
  offset_ns  — north-south offset in metres from that grid (0 if on grid)
  width_m    — width in metres
  depth_m    — depth in metres
  height_m   — height in metres
  rotation_deg — rotation from north in degrees (0=north-facing, 90=east-facing)
  label      — short descriptive label (e.g. "Toilet 1", "Panel LP1")
  notes      — anything notable

Return ONLY a JSON array, no markdown fences:
[{"grid_ref":"C × 7","offset_ew":0.5,"offset_ns":1.2,"width_m":0.7,"depth_m":0.35,"height_m":0.9,"rotation_deg":0,"label":"${opts.label} 1","notes":""}]
If none found, return: []`,

    parseRaw: (raw) => {
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) return [];
      try { return JSON.parse(m[0]); } catch { return []; }
    },

    toDbRecord: (item, idx, storey, floorElev) => {
      const origin = parseGridRef(item.grid_ref ?? "");
      if (!origin) return null;
      const ew = origin.ew + (Number(item.offset_ew) || 0);
      const ns = origin.ns + (Number(item.offset_ns) || 0);
      if (!inEnvelope(ew, ns)) return null;
      const w = Number(item.width_m)  || opts.defaultDims.w;
      const d = Number(item.depth_m)  || opts.defaultDims.d;
      const h = Number(item.height_m) || opts.defaultDims.h;
      return {
        element_id:   `${opts.dbType.toUpperCase()}-${storey}-${String(idx).padStart(3,"0")}`,
        element_type: opts.dbType,
        storey_name:  storey,
        geometry: {
          type:        opts.dbType,
          location:    { realLocation: { x: ew, y: ns, z: floorElev } },
          dimensions:  { width: w, depth: d, height: h },
          rotation_deg: Number(item.rotation_deg) || 0,
        },
        properties: {
          label:  item.label ?? opts.label,
          notes:  item.notes ?? "",
        },
      };
    },
  };
}

// ─── Wall-segment element factory ────────────────────────────────────────────
// For walls, doors, windows that are expressed as start→end grid refs.

function makeWallSegmentEntry(opts: {
  label: string; category: string; dbType: string;
  description: string; defaultThickMm: number; defaultHeightM: number;
  extraPromptLines?: string;
}): RegistryEntry {
  return {
    label: opts.label, category: opts.category,
    prompt: (storey, floorElev) => `You are reading a construction drawing for The Moorings, Cameron Lake ON.
${GRID_HEADER}
Floor elevation: ${floorElev} m  |  Storey: ${storey}

TASK: Identify every ${opts.label} (${opts.description}) visible on this plan.
${opts.extraPromptLines ?? ""}
Express each as a line segment between two grid intersections.
Default thickness: ${opts.defaultThickMm}mm  |  Default height: ${opts.defaultHeightM}m

Return ONLY a JSON array, no markdown fences:
[{"from_grid":"A × 9","to_grid":"A × 1","label":"${opts.label} 1","thickness_mm":${opts.defaultThickMm},"height_m":${opts.defaultHeightM},"notes":""}]
If none found, return: []`,

    parseRaw: (raw) => {
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) return [];
      try { return JSON.parse(m[0]); } catch { return []; }
    },

    toDbRecord: (item, idx, storey, floorElev) => {
      const s = parseGridRef(item.from_grid ?? "");
      const e = parseGridRef(item.to_grid   ?? "");
      if (!s || !e) return null;
      if (!inEnvelope(s.ew,s.ns) || !inEnvelope(e.ew,e.ns)) return null;
      const len = Math.sqrt((e.ew-s.ew)**2 + (e.ns-s.ns)**2);
      if (len < 0.1) return null;
      const cEW = (s.ew+e.ew)/2, cNS = (s.ns+e.ns)/2;
      const thick = (Number(item.thickness_mm) || opts.defaultThickMm) / 1000;
      const h     = Number(item.height_m) || opts.defaultHeightM;
      return {
        element_id:   `${opts.dbType.toUpperCase()}-${storey}-${String(idx).padStart(3,"0")}`,
        element_type: opts.dbType,
        storey_name:  storey,
        geometry: {
          type: opts.dbType, start: { x: s.ew, y: s.ns }, end: { x: e.ew, y: e.ns },
          location: { realLocation: { x: cEW, y: cNS, z: floorElev } },
          dimensions: { width: len, height: h, depth: thick },
        },
        properties: { label: item.label, notes: item.notes ?? "", thickness_mm: Number(item.thickness_mm) || opts.defaultThickMm },
      };
    },
  };
}

// ─── THE FULL REGISTRY ────────────────────────────────────────────────────────

export const ELEMENT_REGISTRY: Record<string, RegistryEntry> = {

  // ── STRUCTURAL ──────────────────────────────────────────────────────────────

  interior_wall: makeWallSegmentEntry({
    label: "Interior Wall", category: "structural", dbType: "interior_wall",
    description: "concrete block, poured concrete, or stud walls inside the building envelope",
    defaultThickMm: 200, defaultHeightM: 3.0,
    extraPromptLines: "Include all internal wall segments shown with solid or hatched lines. Exclude the perimeter/exterior walls.",
  }),

  column: makeFixtureEntry({
    label: "Column", category: "structural", dbType: "column",
    description: "structural columns, square or circular concrete or steel posts",
    symbolHint: "small filled squares or circles on the plan, often at grid intersections",
    defaultDims: { w: 0.4, d: 0.4, h: 3.0 },
    extraPromptLines: "For circular columns set width_m = depth_m = diameter.",
  }),

  beam: makeWallSegmentEntry({
    label: "Beam", category: "structural", dbType: "beam",
    description: "structural beams spanning between columns or walls",
    defaultThickMm: 400, defaultHeightM: 0.6,
  }),

  stair: makeFixtureEntry({
    label: "Stair", category: "structural", dbType: "stair",
    description: "stairwells and stair flights shown with step lines and arrows",
    symbolHint: "parallel lines with direction arrow, usually in a stairwell opening",
    defaultDims: { w: 3.0, d: 6.0, h: 3.5 },
  }),

  foundation: makeWallSegmentEntry({
    label: "Foundation Wall", category: "structural", dbType: "foundation",
    description: "foundation walls or grade beams shown on basement/P1 drawings",
    defaultThickMm: 300, defaultHeightM: 1.5,
  }),

  // ── BUILDING ENVELOPE ───────────────────────────────────────────────────────

  door: {
    label: "Door", category: "envelope",
    prompt: (storey, floorElev) => `You are reading a construction drawing for The Moorings, Cameron Lake ON.
${GRID_HEADER}
Floor elevation: ${floorElev} m  |  Storey: ${storey}

TASK: Identify every door opening visible on this plan.
Doors are shown as an arc (door swing) with a straight line indicating the door leaf.
Include unit entry doors, corridor doors, stairwell doors, and service doors.

Return ONLY a JSON array, no markdown fences:
[{
  "grid_ref": "B × 7",
  "offset_ew": 0.3,
  "offset_ns": 0.0,
  "width_m": 0.9,
  "height_m": 2.1,
  "swing_direction": "inward",
  "hinge_side": "left",
  "label": "Unit Entry 101",
  "notes": ""
}]
If none found, return: []`,
    parseRaw: (raw) => { const m = raw.match(/\[[\s\S]*\]/); if(!m) return []; try{return JSON.parse(m[0]);}catch{return [];} },
    toDbRecord: (item, idx, storey, floorElev) => {
      const origin = parseGridRef(item.grid_ref ?? "");
      if (!origin) return null;
      const ew = origin.ew + (Number(item.offset_ew)||0);
      const ns = origin.ns + (Number(item.offset_ns)||0);
      if (!inEnvelope(ew,ns)) return null;
      const w = Number(item.width_m)||0.9, h = Number(item.height_m)||2.1;
      return {
        element_id: `DOOR-${storey}-${String(idx).padStart(3,"0")}`,
        element_type: "door", storey_name: storey,
        geometry: { type:"door", location:{realLocation:{x:ew,y:ns,z:floorElev}}, dimensions:{width:w,depth:0.05,height:h}, swing_direction:item.swing_direction, hinge_side:item.hinge_side },
        properties: { label:item.label, notes:item.notes??"" },
      };
    },
  },

  window: {
    label: "Window", category: "envelope",
    prompt: (storey, floorElev) => `You are reading a construction drawing for The Moorings, Cameron Lake ON.
${GRID_HEADER}
Floor elevation: ${floorElev} m  |  Storey: ${storey}

TASK: Identify every window opening on this plan.
Windows appear as thin parallel lines in an exterior wall, often with sill lines and/or glazing indication.
Include balcony sliding doors and floor-to-ceiling glazing.

Return ONLY a JSON array, no markdown fences:
[{
  "grid_ref": "A × 7",
  "offset_ns": 2.1,
  "offset_ew": 0.0,
  "width_m": 1.8,
  "height_m": 1.5,
  "sill_height_m": 0.9,
  "label": "Living Room Window",
  "notes": ""
}]
If none found, return: []`,
    parseRaw: (raw) => { const m = raw.match(/\[[\s\S]*\]/); if(!m) return []; try{return JSON.parse(m[0]);}catch{return [];} },
    toDbRecord: (item, idx, storey, floorElev) => {
      const origin = parseGridRef(item.grid_ref ?? "");
      if (!origin) return null;
      const ew = origin.ew + (Number(item.offset_ew)||0);
      const ns = origin.ns + (Number(item.offset_ns)||0);
      if (!inEnvelope(ew,ns)) return null;
      const w = Number(item.width_m)||1.5, h = Number(item.height_m)||1.2;
      const sill = Number(item.sill_height_m)||0.9;
      return {
        element_id: `WIN-${storey}-${String(idx).padStart(3,"0")}`,
        element_type: "window", storey_name: storey,
        geometry: { type:"window", location:{realLocation:{x:ew,y:ns,z:floorElev+sill}}, dimensions:{width:w,depth:0.15,height:h} },
        properties: { label:item.label, sill_height_m:sill, notes:item.notes??"" },
      };
    },
  },

  curtain_wall: makeWallSegmentEntry({
    label: "Curtain Wall / Glazing", category: "envelope", dbType: "curtain_wall",
    description: "floor-to-ceiling glass curtain wall panels or storefront glazing systems",
    defaultThickMm: 150, defaultHeightM: 3.2,
  }),

  // ── FINISHES & FIXTURES ─────────────────────────────────────────────────────

  counter: makeFixtureEntry({
    label: "Counter / Countertop", category: "finishes", dbType: "counter",
    description: "kitchen counters, bathroom vanity counters, reception desks, service counters",
    symbolHint: "rectangular outline with hatch pattern or labelled 'COUNTER' or 'VANITY'",
    defaultDims: { w: 0.6, d: 0.6, h: 0.9 },
  }),

  millwork: makeFixtureEntry({
    label: "Millwork / Cabinetry", category: "finishes", dbType: "millwork",
    description: "built-in cabinetry, cupboards, wardrobes, linen closets shown as rectangles",
    symbolHint: "rectangular outlines labelled 'CABINET', 'WARDROBE', 'LINEN' etc.",
    defaultDims: { w: 0.6, d: 0.4, h: 2.1 },
  }),

  // ── PLUMBING FIXTURES ───────────────────────────────────────────────────────

  toilet: makeFixtureEntry({
    label: "Toilet / Water Closet", category: "plumbing", dbType: "toilet",
    description: "toilets and water closets",
    symbolHint: "the standard WC symbol — oval tank behind a rounded bowl, or WC label",
    defaultDims: { w: 0.37, d: 0.68, h: 0.9 },
  }),

  sink: makeFixtureEntry({
    label: "Sink", category: "plumbing", dbType: "sink",
    description: "kitchen sinks, bathroom sinks, laundry sinks, mop sinks, utility sinks",
    symbolHint: "rectangular or oval basin outline with drain dot at centre; labelled S or SINK",
    defaultDims: { w: 0.6, d: 0.5, h: 0.85 },
  }),

  bathtub: makeFixtureEntry({
    label: "Bathtub / Tub", category: "plumbing", dbType: "bathtub",
    description: "bathtubs and soaker tubs",
    symbolHint: "elongated rectangle with rounded corners and a drain dot at one end",
    defaultDims: { w: 0.76, d: 1.52, h: 0.6 },
  }),

  shower: makeFixtureEntry({
    label: "Shower Stall", category: "plumbing", dbType: "shower",
    description: "shower stalls and walk-in showers",
    symbolHint: "square or rectangular area with diagonal hatch and drain symbol, labelled SHR",
    defaultDims: { w: 0.9, d: 0.9, h: 2.1 },
  }),

  urinal: makeFixtureEntry({
    label: "Urinal", category: "plumbing", dbType: "urinal",
    description: "wall-mounted urinals in washrooms",
    symbolHint: "small semicircular or triangular symbol on a wall in a men's washroom",
    defaultDims: { w: 0.35, d: 0.35, h: 0.6 },
  }),

  floor_drain: makeFixtureEntry({
    label: "Floor Drain", category: "plumbing", dbType: "floor_drain",
    description: "floor drains, area drains, and trench drains",
    symbolHint: "small circle with X or square with drain symbol on floor, labelled FD",
    defaultDims: { w: 0.15, d: 0.15, h: 0.05 },
  }),

  water_heater: makeFixtureEntry({
    label: "Water Heater / HWT", category: "plumbing", dbType: "water_heater",
    description: "domestic hot water tanks and boilers",
    symbolHint: "circle labelled HWT, DHW, or WATER HEATER in mechanical rooms",
    defaultDims: { w: 0.55, d: 0.55, h: 1.5 },
  }),

  // ── HVAC ────────────────────────────────────────────────────────────────────

  hvac_unit: makeFixtureEntry({
    label: "HVAC Unit / Air Handler", category: "hvac", dbType: "hvac_unit",
    description: "air handling units, fan coil units, heat pumps, rooftop units",
    symbolHint: "rectangles labelled AHU, FCU, HP, RTU, or MECHANICAL in mechanical rooms",
    defaultDims: { w: 1.0, d: 0.6, h: 0.9 },
  }),

  exhaust_fan: makeFixtureEntry({
    label: "Exhaust Fan", category: "hvac", dbType: "exhaust_fan",
    description: "bathroom exhaust fans, parking garage exhaust fans, kitchen range hoods",
    symbolHint: "circle with X inside, or labelled EF, exhaust symbol on ceiling plan",
    defaultDims: { w: 0.3, d: 0.3, h: 0.15 },
  }),

  diffuser: makeFixtureEntry({
    label: "Supply/Return Diffuser / Grille", category: "hvac", dbType: "diffuser",
    description: "HVAC supply air diffusers and return air grilles in ceilings or walls",
    symbolHint: "rectangles with cross-hatch or multiple lines, labelled SD, RD, or with CFM note",
    defaultDims: { w: 0.6, d: 0.6, h: 0.05 },
  }),

  // ── ELECTRICAL ──────────────────────────────────────────────────────────────

  light_fixture: makeFixtureEntry({
    label: "Light Fixture", category: "electrical", dbType: "light_fixture",
    description: "ceiling lights, recessed downlights, wall sconces, surface-mounted fixtures",
    symbolHint: "circle or rectangle on ceiling plan with lighting symbol; labelled with fixture type code",
    defaultDims: { w: 0.6, d: 0.6, h: 0.15 },
  }),

  electrical_outlet: makeFixtureEntry({
    label: "Electrical Outlet / Receptacle", category: "electrical", dbType: "electrical_outlet",
    description: "duplex outlets, GFCI outlets, 240V appliance outlets",
    symbolHint: "semicircle or circle with two parallel lines on wall, labelled with outlet type",
    defaultDims: { w: 0.08, d: 0.05, h: 0.1 },
  }),

  electrical_panel: makeFixtureEntry({
    label: "Electrical Panel / Distribution Board", category: "electrical", dbType: "electrical_panel",
    description: "main panels, sub-panels, metering equipment",
    symbolHint: "rectangle labelled LP, DP, MSB, or PANEL; often in electrical or mechanical rooms",
    defaultDims: { w: 0.6, d: 0.2, h: 1.2 },
  }),

  switch: makeFixtureEntry({
    label: "Light Switch", category: "electrical", dbType: "switch",
    description: "light switches, dimmer switches, motion sensors on walls near doors",
    symbolHint: "S symbol on wall near door openings; S2, S3 for multi-way switches",
    defaultDims: { w: 0.08, d: 0.05, h: 0.1 },
  }),

  emergency_light: makeFixtureEntry({
    label: "Emergency / Exit Light", category: "electrical", dbType: "emergency_light",
    description: "emergency egress lights, exit signs over doors",
    symbolHint: "rectangle with 'EXIT' label or emergency light symbol with battery icon",
    defaultDims: { w: 0.35, d: 0.15, h: 0.15 },
  }),

  // ── FIRE & LIFE SAFETY ──────────────────────────────────────────────────────

  sprinkler_head: makeFixtureEntry({
    label: "Sprinkler Head", category: "fire", dbType: "sprinkler_head",
    description: "fire suppression sprinkler heads in ceiling",
    symbolHint: "small circle with X or plus, arranged in a grid pattern on ceiling plan",
    defaultDims: { w: 0.05, d: 0.05, h: 0.08 },
  }),

  fire_extinguisher: makeFixtureEntry({
    label: "Fire Extinguisher / Cabinet", category: "fire", dbType: "fire_extinguisher",
    description: "portable fire extinguishers and fire hose cabinets",
    symbolHint: "rectangle labelled FE or FHC on walls, typically in corridors",
    defaultDims: { w: 0.15, d: 0.15, h: 0.7 },
  }),

  standpipe: makeFixtureEntry({
    label: "Standpipe / Siamese Connection", category: "fire", dbType: "standpipe",
    description: "fire standpipes, Siamese connections, and fire department connections",
    symbolHint: "circle labelled SP or FDC on plan, often at stairwells or building exterior",
    defaultDims: { w: 0.15, d: 0.15, h: 1.0 },
  }),

  fire_alarm: makeFixtureEntry({
    label: "Fire Alarm Device", category: "fire", dbType: "fire_alarm",
    description: "smoke detectors, heat detectors, pull stations, horns/strobes",
    symbolHint: "square or triangle labelled SD, HD, PS, H/S near corridors and rooms",
    defaultDims: { w: 0.1, d: 0.05, h: 0.1 },
  }),
};

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ExtractionResult {
  elementType: string;
  inserted:    number;
  skipped:     number;
  reasons:     string[];
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * Extract one element type from a drawing using Claude Vision.
 * Validates coordinates, then writes to bim_elements.
 *
 * @param modelId      BIM model UUID
 * @param pdfPath      Path to the PDF drawing
 * @param anthropic    Anthropic client
 * @param elementType  Key in ELEMENT_REGISTRY (or "all" to run everything)
 * @param storey       Storey name to tag elements with (e.g. "P1", "GF")
 * @param floorElev    Floor elevation in metres (negative = underground)
 * @param replace      If true, delete existing elements of this type on this storey first
 */
export async function extractElementType(
  modelId:     string,
  pdfPath:     string,
  anthropic:   Anthropic,
  elementType: string,
  storey:      string   = "P1",
  floorElev:   number   = -4.65,
  replace:     boolean  = true,
): Promise<ExtractionResult[]> {

  const types = elementType === "all"
    ? Object.keys(ELEMENT_REGISTRY)
    : [elementType];

  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
  const results: ExtractionResult[] = [];

  for (const et of types) {
    const entry = ELEMENT_REGISTRY[et];
    if (!entry) {
      results.push({ elementType: et, inserted: 0, skipped: 0, reasons: [`Unknown element type: "${et}"`] });
      continue;
    }

    const result: ExtractionResult = { elementType: et, inserted: 0, skipped: 0, reasons: [] };

    try {
      // 1. Call Claude Vision
      const response = await anthropic.messages.create({
        model:      "claude-opus-4-5",
        max_tokens: 4096,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text",     text: entry.prompt(storey, floorElev) },
          ],
        }],
      });

      const raw = (response.content[0] as any).text?.trim() ?? "";
      result.reasons.push(`[Claude] First 300 chars: ${raw.slice(0, 300)}`);

      // 2. Parse
      const items: any[] = entry.parseRaw(raw);
      if (items.length === 0) {
        result.reasons.push("No elements found in this drawing for this type (Claude returned empty array)");
        results.push(result);
        continue;
      }

      // 3. Delete existing (if replacing)
      if (replace) {
        await pool.query(
          `DELETE FROM bim_elements WHERE model_id=$1 AND element_type=$2 AND storey_name=$3`,
          [modelId, et, storey],
        );
      }

      // 4. Validate + insert
      let idx = 1;
      for (const item of items) {
        const record = entry.toDbRecord(item, idx, storey, floorElev);
        if (!record) {
          result.skipped++;
          result.reasons.push(`[SKIP] item ${idx} failed validation (bad grid ref or out of envelope)`);
          idx++;
          continue;
        }

        await pool.query(
          `INSERT INTO bim_elements (id, model_id, element_id, element_type, storey_name, geometry, properties)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [modelId, record.element_id, record.element_type, record.storey_name, record.geometry, record.properties],
        );
        result.inserted++;
        idx++;
      }

      // 5. Update element count
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM bim_elements WHERE model_id=$1`, [modelId]);
      await pool.query(`UPDATE bim_models SET element_count=$1 WHERE id=$2`, [rows[0].cnt, modelId]);

    } catch (err: any) {
      result.reasons.push(`[ERROR] ${err.message ?? String(err)}`);
    }

    results.push(result);
  }

  return results;
}

/** List all supported element types with their category and label */
export function listSupportedElementTypes() {
  return Object.entries(ELEMENT_REGISTRY).map(([key, e]) => ({
    type: key, label: e.label, category: e.category,
  }));
}
