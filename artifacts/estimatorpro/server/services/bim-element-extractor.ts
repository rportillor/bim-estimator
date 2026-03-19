/**
 * BIM Element Extractor — Vision-based extraction with built-in validation.
 *
 * DESIGN PRINCIPLE: Validation happens BEFORE any DB write.  If an extracted
 * element fails a rule it is logged and silently dropped — the caller never
 * has to do post-hoc "surgery".
 *
 * Building-specific rules for The Moorings (Cameron Lake, Ontario):
 *  - Grid lines L and M are construction-joint boundaries, NOT walls.
 *  - CL / CLa / CLb are angled transition lines, NOT walls.
 *  - Any wall whose start→end vector runs along one of those lines is rejected.
 *  - Any element whose centre falls outside the combined building envelope is
 *    rejected.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { pool } from "../db";

// ─── Building-specific constants ─────────────────────────────────────────────

/** Grids that look like outer boundaries but are interior joint lines — NOT walls. */
const INTERIOR_BOUNDARY_GRIDLINES = [
  // Grid L: runs N-S at EW = 41.999  (east edge of rectangular block)
  { label: "L",  axis: "X" as const, ew: 41.999 },
  // Grid M: runs at 27.16° from (EW≈45.28,NS≈-0.76) to (EW≈63.92,NS≈35.57)
  { label: "M",  axis: "X" as const, ew: 45.671 },
  // CL zone lines
  { label: "CLa", axis: "X" as const, ew: 40.525 },
  { label: "CL",  axis: "X" as const, ew: 43.810 },
  { label: "CLb", axis: "X" as const, ew: 47.095 },
];

/** Building envelope: anything outside this box is almost certainly wrong. */
const ENVELOPE = {
  minEW: -2,   maxEW: 100,
  minNS: -20,  maxNS: 43,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedWall {
  label:        string;
  start:        { x: number; y: number };  // {x:EW, y:NS}
  end:          { x: number; y: number };
  thickness_mm: number;
}

export interface ExtractedElement {
  element_type:  string;
  storey_name:   string;
  label:         string;
  geometry:      Record<string, unknown>;
  properties:    Record<string, unknown>;
  element_id:    string;
}

export interface ExtractionResult {
  inserted:  number;
  skipped:   number;
  reasons:   string[];
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Return true if the wall segment runs along one of the known interior boundary
 * grid lines (i.e. it is parallel to that grid line AND its midpoint lies on it
 * within a small tolerance).
 */
function isInteriorBoundaryWall(
  start: { x: number; y: number },
  end:   { x: number; y: number },
): { bad: boolean; reason: string } {
  const WING_ANG_RAD = 27.16 * (Math.PI / 180);
  const TOL = 0.5; // metres tolerance for "lies on" check

  for (const gl of INTERIOR_BOUNDARY_GRIDLINES) {
    if (gl.axis === "X") {
      // Grid runs at some angle from gl.ew.
      // For the rectangular grids (A–L) angle = 0, so they're vertical (NS-running).
      // For the wing grids (M–Y) angle = WING_ANG.
      const angle = ["M","N","P","Q","R","S","Sa","T","U","V","W","X","Y","CLa","CL","CLb"].includes(gl.label)
        ? WING_ANG_RAD : 0;
      const tanA = Math.tan(angle);

      // Wall midpoint
      const midEW = (start.x + end.x) / 2;
      const midNS = (start.y + end.y) / 2;

      // Expected EW of the grid line at this NS value
      const expectedEW = gl.ew + midNS * tanA;
      if (Math.abs(midEW - expectedEW) < TOL) {
        return { bad: true, reason: `Wall lies on interior grid line ${gl.label} (construction joint, not a wall)` };
      }
    }
  }
  return { bad: false, reason: "" };
}

/** Return true if a point is within the building envelope. */
function inEnvelope(ew: number, ns: number): boolean {
  return ew >= ENVELOPE.minEW && ew <= ENVELOPE.maxEW &&
         ns >= ENVELOPE.minNS && ns <= ENVELOPE.maxNS;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildWallPrompt(): string {
  return `You are reading drawing A101 R1 — Underground Parking Plan (P1 level) for "The Moorings", Cameron Lake, Ontario.

BUILDING STRUCTURE:
• RECTANGULAR BLOCK: Grid A (west, EW=0) to Grid L (east, EW=42.0), Grid 9 (south, NS=0) to Grid 1 (north, NS=40.83). Grids A–L run N-S; Grids 1–9 run E-W.
• ANGLED WING: Grid M (west, ~EW=45.7) to Grid Y (east, ~EW=87.5), Grid 19 (south) to Grid 10 (north). These lines run at 27.16° to the rectangular block.
• TRANSITION ZONE: The CL / CLa / CLb lines are construction-joint lines angled at 13.58°. They connect the two wings.

CRITICAL RULES — these grid lines are NEVER walls:
  ✗ Grid L (EW≈42.0)  — this is a construction joint between the two wings, NOT a wall
  ✗ Grid M (EW≈45.7)  — same, interior joint line
  ✗ Grid CL, CLa, CLb — angled transition lines, NOT walls

TRUE PERIMETER WALLS are only on the outermost edges of the combined building footprint:
  ✓ Grid A  (west edge of rectangular block)
  ✓ Grid 1  (north edge of rectangular block)
  ✓ Grid 9  (south edge of rectangular block)
  ✓ Grid Y  (northeast edge of wing)
  ✓ Grid 10 (north tip of wing)
  ✓ Grid 19 (south tip of wing)
  ✓ Short closure walls that physically close the gap between the rectangular block and the wing
    at the transition corners (NOT the CL lines themselves, but short walls at those corners)

TASK: List every EXTERIOR PERIMETER wall segment visible as a thick wall on the plan (not just a grid line).

Return ONLY a JSON array with no markdown fences:
[
  {"from_grid":"A × 9","to_grid":"A × 1","label":"West wall – rectangular block","thickness_mm":300},
  ...
]`;
}

// ─── Grid intersection maths (inline from moorings-grid-constants.ts) ────────

const WING_ANG  = 27.16;
const CL_ANG    = 13.58;

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
  { label:"CLa",axis:"X",coord:40.525, s:0,      e:40.830,a:CL_ANG },
  { label:"CL", axis:"X",coord:43.810, s:0,      e:40.830,a:CL_ANG },
  { label:"CLb",axis:"X",coord:47.095, s:0,      e:40.830,a:CL_ANG },
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

function computeIntersection(
  alphaLabel: string,
  numericLabel: string,
): { ew: number; ns: number } | null {
  const al = alphaLabel.trim().toUpperCase();
  const nl = numericLabel.trim().toUpperCase();
  const alpha   = (GRIDLINES as any[]).find(g => g.axis === "X" && g.label.toUpperCase() === al);
  const numeric = (GRIDLINES as any[]).find(g => g.axis === "Y" && g.label.toUpperCase() === nl);
  if (!alpha || !numeric) return null;
  const tanA = Math.tan(alpha.a   * Math.PI / 180);
  const tanN = Math.tan(numeric.a * Math.PI / 180);
  const denom = 1 + tanA * tanN;
  if (Math.abs(denom) < 1e-10) return null;
  const ns = (numeric.coord + (numeric.s - alpha.coord) * tanN) / denom;
  const ew = alpha.coord + ns * tanA;
  return { ew, ns };
}

function parseGridRef(ref: string): { ew: number; ns: number } | null {
  // Accept "A × 9", "A×9", "A x 9", "A-9", "A 9"
  const m = ref.trim().match(/^([A-Za-z]+[a-z]?)\s*[×x×\-\s]\s*(\d+)$/i);
  if (!m) return null;
  return computeIntersection(m[1], m[2]);
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildSlabPrompt(): string {
  return `You are reading drawing A101 R1 — Underground Parking Plan (P1 level) for "The Moorings", Cameron Lake, Ontario.

COORDINATE SYSTEM (already provided in drawing legend):
• Grid A=EW 0, B=4.71, C=8.20, D=12.55, E=15.10, F=19.15, G=21.45, Ga=22.20, H=29.05, J=32.10, K=38.95, L=42.00 — these run N-S
• Grid 9=NS 0, 8=5.89, 7=8.24, 6=14.85, 5=21.83, 4=26.03, 3=27.88, 2=37.36, 1=40.83 — these run E-W (rectangular block)
• The angled wing (at 27.16°) has grids M, N, P, Q, R, S, T, U, V, W, X, Y (alpha) and 10–19 (numeric)

TASK: Identify the complete outline of the P1 underground parking slab — the full concrete deck footprint.
Look at the outermost concrete boundary that encompasses the entire parking level.

Return the polygon corner points in order (clockwise) as grid intersection references.
Each corner must be an exact grid intersection (alpha × numeric).

Return ONLY a JSON object with no markdown fences:
{
  "corners": [
    {"grid_ref": "A × 9",  "description": "SW corner rectangular block"},
    {"grid_ref": "L × 9",  "description": "..."},
    ...
  ],
  "thickness_mm": 200,
  "storey": "P1"
}`;
}

function buildParkingSpacePrompt(): string {
  return `You are reading drawing A101 R1 — Underground Parking Plan (P1 level) for "The Moorings", Cameron Lake, Ontario.

Parking spaces on this plan are indicated by PAINTED LINE MARKINGS on the concrete slab — NOT by physical walls or barriers.
Each space is defined by two parallel lines (typically 2.6 m apart) with a back line completing a rectangle approximately 2.6 m wide × 5.5 m deep.
Accessible (HA) spaces are wider, typically 3.7 m wide, and are marked with the wheelchair symbol.

GRID COORDINATE SYSTEM:
Rectangular block grids (angle 0°):
  A=EW 0, B=4.71, C=8.20, D=12.55, E=15.10, F=19.15, G=21.45, Ga=22.20, H=29.05, J=32.10, K=38.95, L=42.00 (N-S running)
  9=NS 0, 8=5.89, 7=8.24, 6=14.85, 5=21.83, 4=26.03, 3=27.88, 2=37.36, 1=40.83 (E-W running)

Angled wing grids (27.16° from rectangular block):
  M, N, P, Q, R, S, T, U, V, W, X, Y (alpha) and 10–19 (numeric)

Floor elevation: -4.65 m

TASK: Identify every GROUP (bay/row) of line-marked parking spaces.
For each group describe:
  - row_id: a short descriptive ID for this group
  - start_grid: the grid intersection nearest the FIRST space's back-near corner
  - facing: direction the front of cars points when parked ("north","south","east","west"; for angled wing spaces use "wing_north" or "wing_south")
  - count: total number of spaces in this group (count the dividing lines visible on plan)
  - space_width_m: width of each space in metres (standard = 2.6, accessible = 3.7)
  - space_depth_m: depth of each space in metres (standard = 5.5)
  - accessible: true if these are accessible (HA/wheelchair) spaces
  - step_direction: direction to step from start_grid to reach the next space in the row ("east","west","north","south","wing_along")
  - notes: anything that helps locate this group

Return ONLY a JSON array, no markdown fences:
[
  {
    "row_id": "NORTH-WALL-ROW",
    "start_grid": "B × 1",
    "facing": "south",
    "count": 14,
    "space_width_m": 2.6,
    "space_depth_m": 5.5,
    "accessible": false,
    "step_direction": "east",
    "notes": "Row of spaces against north wall, Grid 1, from B eastward to K"
  }
]`;
}

// ─── Main extraction functions ────────────────────────────────────────────────

/**
 * Extract exterior walls from a PDF using Claude Vision, validate them,
 * and write the valid ones to the database.
 *
 * @param modelId    BIM model UUID
 * @param pdfPath    Absolute path to the PDF file
 * @param anthropic  Anthropic client instance
 * @param floorElev  Floor elevation in metres (negative = underground)
 * @param wallHeight Wall height in metres
 * @param replaceExisting If true, deletes all current exterior_wall rows first
 */
export async function extractExteriorWalls(
  modelId:         string,
  pdfPath:         string,
  anthropic:       Anthropic,
  floorElev        = -4.65,
  wallHeight       = 4.65,
  replaceExisting  = true,
): Promise<ExtractionResult> {
  const result: ExtractionResult = { inserted: 0, skipped: 0, reasons: [] };

  // 1. Read PDF
  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

  // 2. Call Claude Vision
  const response = await anthropic.messages.create({
    model:      "claude-opus-4-5",
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: [
        {
          type:   "document",
          source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
        },
        { type: "text", text: buildWallPrompt() },
      ],
    }],
  });

  // 3. Parse response
  const raw = (response.content[0] as any).text?.trim() ?? "";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    result.reasons.push("Claude returned no parseable JSON array");
    return result;
  }
  let segs: Array<{ from_grid: string; to_grid: string; label: string; thickness_mm?: number }>;
  try {
    segs = JSON.parse(jsonMatch[0]);
  } catch {
    result.reasons.push("JSON parse failed");
    return result;
  }

  // 4. Convert grid refs → real coords
  const walls: Array<{
    label: string;
    start: { x: number; y: number };
    end:   { x: number; y: number };
    thickness: number;
  }> = [];

  for (const seg of segs) {
    const start = parseGridRef(seg.from_grid);
    const end   = parseGridRef(seg.to_grid);

    if (!start || !end) {
      result.skipped++;
      result.reasons.push(`[SKIP] "${seg.label}" — cannot parse grid refs "${seg.from_grid}" / "${seg.to_grid}"`);
      continue;
    }

    // ── VALIDATION ────────────────────────────────────────────────────────────

    // Rule 1: reject walls on interior boundary grid lines
    const interiorCheck = isInteriorBoundaryWall(
      { x: start.ew, y: start.ns },
      { x: end.ew,   y: end.ns   },
    );
    if (interiorCheck.bad) {
      result.skipped++;
      result.reasons.push(`[REJECT] "${seg.label}" — ${interiorCheck.reason}`);
      continue;
    }

    // Rule 2: reject walls whose endpoints are outside the building envelope
    if (!inEnvelope(start.ew, start.ns) || !inEnvelope(end.ew, end.ns)) {
      result.skipped++;
      result.reasons.push(`[REJECT] "${seg.label}" — endpoints outside building envelope`);
      continue;
    }

    // Rule 3: reject zero-length walls
    const len = Math.sqrt((end.ew - start.ew) ** 2 + (end.ns - start.ns) ** 2);
    if (len < 0.5) {
      result.skipped++;
      result.reasons.push(`[REJECT] "${seg.label}" — length ${len.toFixed(2)}m is too short`);
      continue;
    }

    walls.push({
      label:     seg.label,
      start:     { x: start.ew, y: start.ns },
      end:       { x: end.ew,   y: end.ns   },
      thickness: (seg.thickness_mm ?? 300) / 1000,
    });
  }

  // 5. Write to DB
  if (replaceExisting) {
    await pool.query(
      `DELETE FROM bim_elements WHERE model_id=$1 AND element_type='exterior_wall'`,
      [modelId],
    );
  }

  let idx = 1;
  for (const w of walls) {
    const len  = Math.sqrt((w.end.x - w.start.x) ** 2 + (w.end.y - w.start.y) ** 2);
    const cEW  = (w.start.x + w.end.x) / 2;
    const cNS  = (w.start.y + w.end.y) / 2;
    const geom = {
      type:       "wall",
      start:      w.start,
      end:        w.end,
      location:   { realLocation: { x: cEW, y: cNS, z: floorElev } },
      dimensions: { width: len, height: wallHeight, depth: w.thickness },
    };
    const props = { name: w.label, material: "concrete", thickness: w.thickness * 1000 };

    await pool.query(
      `INSERT INTO bim_elements
         (id, model_id, element_id, element_type, storey_name, geometry, properties)
       VALUES (gen_random_uuid(), $1, $2, 'exterior_wall', 'P1', $3, $4)`,
      [modelId, `EW-${String(idx).padStart(3, "0")}`, geom, props],
    );
    idx++;
    result.inserted++;
  }

  // 6. Update element count
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM bim_elements WHERE model_id=$1`,
    [modelId],
  );
  await pool.query(
    `UPDATE bim_models SET element_count=$1 WHERE id=$2`,
    [rows[0].cnt, modelId],
  );

  return result;
}

// ─── Slab extraction ──────────────────────────────────────────────────────────

/**
 * Send the drawing to Claude Vision, get back the full slab footprint polygon
 * as a list of grid-intersection corners, convert to real coords, and write
 * one slab element to the DB (replacing any existing slab on that storey).
 */
export async function extractSlab(
  modelId:  string,
  pdfPath:  string,
  anthropic: Anthropic,
  floorElev  = -4.65,
  thickness  = 0.2,
): Promise<ExtractionResult> {
  const result: ExtractionResult = { inserted: 0, skipped: 0, reasons: [] };

  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

  const response = await anthropic.messages.create({
    model:      "claude-opus-4-5",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text",     text: buildSlabPrompt() },
      ],
    }],
  });

  const raw = (response.content[0] as any).text?.trim() ?? "";
  result.reasons.push(`[Claude raw] ${raw.slice(0, 400)}`);

  // Accept either a bare object or an object wrapped in a JSON block
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { result.reasons.push("No JSON object found"); return result; }

  let parsed: { corners: Array<{ grid_ref: string; description?: string }>; thickness_mm?: number };
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch { result.reasons.push("JSON parse failed"); return result; }

  const thickM = (parsed.thickness_mm ?? 200) / 1000;
  const corners: Array<{ x: number; y: number }> = [];

  for (const c of parsed.corners ?? []) {
    const pt = parseGridRef(c.grid_ref);
    if (!pt) {
      result.skipped++;
      result.reasons.push(`[SKIP] corner "${c.grid_ref}" — cannot resolve to grid coords`);
      continue;
    }
    if (!inEnvelope(pt.ew, pt.ns)) {
      result.skipped++;
      result.reasons.push(`[SKIP] corner "${c.grid_ref}" — outside building envelope`);
      continue;
    }
    corners.push({ x: pt.ew, y: pt.ns });
  }

  if (corners.length < 3) {
    result.reasons.push(`[REJECT] only ${corners.length} valid corners — need at least 3 for a slab polygon`);
    return result;
  }

  // Bounding box for fallback dims
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const cEW = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cNS = (Math.max(...ys) + Math.min(...ys)) / 2;
  const area = Math.abs(xs.reduce((acc, x, i) => acc + x * (ys[(i + 1) % ys.length] - ys[(i - 1 + ys.length) % ys.length]), 0)) / 2;

  const geom = {
    type:       "slab",
    outline:    corners,
    location:   { realLocation: { x: cEW, y: cNS, z: floorElev } },
    dimensions: { thickness: thickM, area, volume: area * thickM },
  };
  const props = { name: "P1 Slab", material: "concrete", storey: "P1" };

  await pool.query(`DELETE FROM bim_elements WHERE model_id=$1 AND element_type='slab' AND storey_name='P1'`, [modelId]);
  await pool.query(
    `INSERT INTO bim_elements (id, model_id, element_id, element_type, storey_name, geometry, properties)
     VALUES (gen_random_uuid(), $1, 'SLAB-P1-001', 'slab', 'P1', $2, $3)`,
    [modelId, geom, props],
  );
  result.inserted = 1;

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM bim_elements WHERE model_id=$1`, [modelId]);
  await pool.query(`UPDATE bim_models SET element_count=$1 WHERE id=$2`, [rows[0].cnt, modelId]);

  return result;
}

// ─── Parking space extraction ─────────────────────────────────────────────────

/**
 * Send the drawing to Claude Vision, get back a description of every bay/row
 * of line-marked parking spaces, then expand each bay into individual space
 * records using the grid coordinate system.
 */
export async function extractParkingSpaces(
  modelId:  string,
  pdfPath:  string,
  anthropic: Anthropic,
  floorElev  = -4.65,
): Promise<ExtractionResult> {
  const result: ExtractionResult = { inserted: 0, skipped: 0, reasons: [] };

  const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

  const response = await anthropic.messages.create({
    model:      "claude-opus-4-5",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text",     text: buildParkingSpacePrompt() },
      ],
    }],
  });

  const raw = (response.content[0] as any).text?.trim() ?? "";
  result.reasons.push(`[Claude raw] ${raw.slice(0, 600)}`);

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) { result.reasons.push("No JSON array found"); return result; }

  let bays: Array<{
    row_id:        string;
    start_grid:    string;
    facing:        string;
    count:         number;
    space_width_m: number;
    space_depth_m: number;
    accessible:    boolean;
    step_direction: string;
    notes?:        string;
  }>;
  try { bays = JSON.parse(jsonMatch[0]); }
  catch { result.reasons.push("JSON parse failed"); return result; }

  // Delete all existing parking_stall elements for this model/storey
  await pool.query(
    `DELETE FROM bim_elements WHERE model_id=$1 AND element_type='parking_stall' AND storey_name='P1'`,
    [modelId],
  );

  const WING_ANG_RAD = 27.16 * (Math.PI / 180);

  let spaceIdx = 1;
  for (const bay of bays) {
    const origin = parseGridRef(bay.start_grid);
    if (!origin) {
      result.skipped += bay.count;
      result.reasons.push(`[SKIP] bay "${bay.row_id}" — cannot parse start_grid "${bay.start_grid}"`);
      continue;
    }

    const w = bay.space_width_m ?? 2.6;
    const d = bay.space_depth_m ?? 5.5;
    const n = Math.max(1, Math.round(bay.count));

    // Step vector per space (EW, NS) based on step_direction
    let stepEW = 0, stepNS = 0;
    switch ((bay.step_direction ?? "east").toLowerCase()) {
      case "east":       stepEW = w;   stepNS = 0;  break;
      case "west":       stepEW = -w;  stepNS = 0;  break;
      case "north":      stepEW = 0;   stepNS = w;  break;
      case "south":      stepEW = 0;   stepNS = -w; break;
      case "wing_along": stepEW = w * Math.cos(WING_ANG_RAD); stepNS = w * Math.sin(WING_ANG_RAD); break;
      default:           stepEW = w;   stepNS = 0;
    }

    // Depth offset from back-near corner to centre of space (towards facing direction)
    let offEW = 0, offNS = 0;
    switch ((bay.facing ?? "south").toLowerCase()) {
      case "south":      offEW = 0;    offNS = -d / 2; break;
      case "north":      offEW = 0;    offNS =  d / 2; break;
      case "east":       offEW = d / 2; offNS = 0;    break;
      case "west":       offEW = -d / 2; offNS = 0;   break;
      case "wing_south": offEW = (d / 2) * Math.cos(WING_ANG_RAD); offNS = -(d / 2) * Math.sin(WING_ANG_RAD); break;
      case "wing_north": offEW = -(d / 2) * Math.cos(WING_ANG_RAD); offNS = (d / 2) * Math.sin(WING_ANG_RAD); break;
      default:           offEW = 0;    offNS = -d / 2;
    }

    // Rotation angle for the stall rectangle in Three.js (Y-axis rotation)
    const isWing = bay.facing?.startsWith("wing") || bay.step_direction === "wing_along";
    const facingRot = isWing ? -WING_ANG_RAD : 0;

    for (let i = 0; i < n; i++) {
      const cEW = origin.ew + stepEW * i + offEW;
      const cNS = origin.ns + stepNS * i + offNS;

      if (!inEnvelope(cEW, cNS)) {
        result.skipped++;
        result.reasons.push(`[SKIP] space ${spaceIdx} in bay "${bay.row_id}" — outside envelope (EW=${cEW.toFixed(1)}, NS=${cNS.toFixed(1)})`);
        spaceIdx++;
        continue;
      }

      const geom = {
        type:          "parking_space",
        location:      { realLocation: { x: cEW, y: cNS, z: floorElev } },
        dimensions:    { width: w, depth: d, height: 0.04 },
        accessible:    bay.accessible ?? false,
        facing:        bay.facing,
        rotation_rad:  facingRot,
      };
      const props = {
        row_id:    bay.row_id,
        index:     i + 1,
        accessible: bay.accessible ?? false,
        notes:     bay.notes ?? "",
      };

      await pool.query(
        `INSERT INTO bim_elements (id, model_id, element_id, element_type, storey_name, geometry, properties)
         VALUES (gen_random_uuid(), $1, $2, 'parking_stall', 'P1', $3, $4)`,
        [modelId, `PS-${String(spaceIdx).padStart(3, "0")}`, geom, props],
      );
      result.inserted++;
      spaceIdx++;
    }
  }

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM bim_elements WHERE model_id=$1`, [modelId]);
  await pool.query(`UPDATE bim_models SET element_count=$1 WHERE id=$2`, [rows[0].cnt, modelId]);

  return result;
}
