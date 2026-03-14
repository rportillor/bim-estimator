// server/bim/mep-schedule-extractor.ts
// Extracts real MEP (Mechanical, Electrical, Plumbing) data from construction
// drawings using Claude's vision API. Replaces hardcoded duct dimensions,
// elevations, and routing with values parsed from actual M-sheets, P-sheets,
// and Reflected Ceiling Plans.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-20250514';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single duct entry parsed from a duct schedule table on an M-sheet. */
export interface DuctScheduleEntry {
  tag: string;
  system: 'supply' | 'return' | 'exhaust' | 'outside_air';
  shape: 'rectangular' | 'round' | 'oval';
  width_mm: number | null;
  height_mm: number | null;
  diameter_mm: number | null;
  cfm: number | null;
  velocity_fpm: number | null;
  static_pressure: number | null;
  insulation: string | null;
  material: string | null;
  source_drawing: string;
}

/** A single pipe entry parsed from a pipe schedule. */
export interface PipeScheduleEntry {
  tag: string;
  system:
    | 'chilled_water'
    | 'hot_water'
    | 'domestic_cold'
    | 'domestic_hot'
    | 'sanitary'
    | 'storm';
  diameter_mm: number | null;
  material: string | null;
  insulation: string | null;
  routing: Waypoint[];
  source_drawing: string;
}

/** An equipment tag with its connections and specs. */
export interface EquipmentEntry {
  tag: string;
  type: string;
  location: { x: number; y: number } | null;
  connections: EquipmentConnection[];
  specs: Record<string, number | string>;
  source_drawing: string;
}

export interface EquipmentConnection {
  duct_tag: string;
  direction: string;
  connection_point: string;
}

/** Data extracted from a Reflected Ceiling Plan. */
export interface RCPEntry {
  room_name: string;
  ceiling_height_m: number | null;
  plenum_depth_m: number | null;
  duct_mounting_height_m: number | null;
  diffuser_locations: DiffuserLocation[];
  source_drawing: string;
}

export interface DiffuserLocation {
  x: number;
  y: number;
  type: string;
}

/** A 3-D waypoint along a duct or pipe run. */
export interface Waypoint {
  x: number;
  y: number;
  z: number;
  size?: { w: number; h: number } | { diameter: number };
}

/** A fitting along a duct run. */
export interface Fitting {
  type: string;
  position: { x: number; y: number; z: number };
  angle?: number;
  from?: string;
  to?: string;
}

/** A terminal device on a duct run (diffuser, grille, etc). */
export interface Terminal {
  type: string;
  tag: string;
  position: { x: number; y: number; z: number };
}

/** A fully traced duct run with routing, fittings and terminals. */
export interface DuctRoutingEntry {
  duct_tag: string;
  system: 'supply' | 'return' | 'exhaust' | 'outside_air';
  routing: Waypoint[];
  fittings: Fitting[];
  connected_equipment: string[];
  terminals: Terminal[];
  source_drawing: string;
}

// ── Aggregate result types ──────────────────────────────────────────────────

export interface MEPScheduleResult {
  ducts: DuctScheduleEntry[];
  pipes: PipeScheduleEntry[];
  drawing_id: string;
  raw_response: string;
}

export type DuctRoutingResult = DuctRoutingEntry;

export type RCPResult = RCPEntry;

export type EquipmentResult = EquipmentEntry;

/** The combined model built from all extraction passes. */
export interface MEPModelData {
  ducts: DuctScheduleEntry[];
  pipes: PipeScheduleEntry[];
  duct_routing: DuctRoutingResult[];
  rcp: RCPResult[];
  equipment: EquipmentResult[];
  duct_lookup: Map<string, DuctScheduleEntry>;
  equipment_lookup: Map<string, EquipmentResult>;
  room_elevations: Map<string, { ceiling_m: number; duct_mounting_m: number }>;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SCHEDULE_EXTRACTION_PROMPT = `You are analysing a construction MEP (Mechanical/Electrical/Plumbing) drawing image.
Your task is to extract ALL duct schedules and pipe schedules visible on this sheet.

Look for:
1. **Duct Schedule tables** - usually titled "DUCT SCHEDULE", "DUCTWORK SCHEDULE", or similar.
   Each row has: tag/mark, system type, shape, dimensions (WxH or diameter), CFM, velocity, static pressure, insulation, material.
2. **Pipe Schedule tables** - titled "PIPE SCHEDULE", "PIPING SCHEDULE", or similar.
   Each row has: tag/mark, system, diameter, material, insulation.
3. **Notes** referencing duct or pipe sizing that might not be in a formal table.

For system classification use ONLY these values:
- Ducts: "supply", "return", "exhaust", "outside_air"
- Pipes: "chilled_water", "hot_water", "domestic_cold", "domestic_hot", "sanitary", "storm"

Return ONLY valid JSON (no markdown fences):
{
  "ducts": [
    {
      "tag": "<string>",
      "system": "<supply|return|exhaust|outside_air>",
      "shape": "<rectangular|round|oval>",
      "width_mm": <number|null>,
      "height_mm": <number|null>,
      "diameter_mm": <number|null>,
      "cfm": <number|null>,
      "velocity_fpm": <number|null>,
      "static_pressure": <number|null>,
      "insulation": "<string|null>",
      "material": "<string|null>"
    }
  ],
  "pipes": [
    {
      "tag": "<string>",
      "system": "<chilled_water|hot_water|domestic_cold|domestic_hot|sanitary|storm>",
      "diameter_mm": <number|null>,
      "material": "<string|null>",
      "insulation": "<string|null>"
    }
  ]
}

If no schedules are found, return: { "ducts": [], "pipes": [] }
Convert imperial dimensions to metric mm (1 inch = 25.4 mm). If dimensions are given in inches, multiply by 25.4.`;

const EQUIPMENT_EXTRACTION_PROMPT = `You are analysing a construction MEP drawing image.
Your task is to identify ALL mechanical/HVAC equipment tags and their duct/pipe connections.

Look for:
1. **Equipment symbols** - AHU, RTU, FCU, VAV, exhaust fans, pumps, chillers, boilers, etc.
2. **Equipment tags** - e.g. "AHU-01", "RTU-1", "EF-3", "FCU-2A", "P-1"
3. **Connection lines** - ducts or pipes connecting to equipment, with their tags/labels.
4. **Equipment schedules** - tables listing equipment with specs (CFM, tonnage, HP, etc.)
5. **Approximate positions** on the plan (estimate x,y coordinates in metres from bottom-left).

Return ONLY valid JSON (no markdown fences):
{
  "equipment": [
    {
      "tag": "<string>",
      "type": "<air_handling_unit|rooftop_unit|fan_coil_unit|vav_box|exhaust_fan|pump|chiller|boiler|other>",
      "location": { "x": <number>, "y": <number> } or null,
      "connections": [
        {
          "duct_tag": "<string>",
          "direction": "<supply|return|exhaust|outside_air|chilled_water|hot_water>",
          "connection_point": "<discharge|intake|supply|return>"
        }
      ],
      "specs": { "<key>": <value> }
    }
  ]
}

If no equipment found, return: { "equipment": [] }`;

const RCP_EXTRACTION_PROMPT = `You are analysing a Reflected Ceiling Plan (RCP) from a construction drawing set.
Your task is to extract ceiling heights, plenum depths, and diffuser/grille locations.

Look for:
1. **Room labels** with ceiling height annotations (e.g. "CLG @ 9'-0" AFF", "2750 AFC").
2. **Plenum depths** - sometimes noted as distance between ceiling and structure above.
3. **Diffuser symbols** - supply air diffusers (square, round, linear, slot), return air grilles.
4. **Mounting heights** for ductwork above ceiling.
5. **Section references** that might show plenum details.

For heights, convert everything to metres. Common conversions:
- 9'-0" = 2.743 m, 10'-0" = 3.048 m, 8'-6" = 2.591 m
- If given in mm, divide by 1000.

Estimate diffuser x,y positions in metres from the bottom-left of the drawing.

Return ONLY valid JSON (no markdown fences):
{
  "rooms": [
    {
      "room_name": "<string>",
      "ceiling_height_m": <number|null>,
      "plenum_depth_m": <number|null>,
      "duct_mounting_height_m": <number|null>,
      "diffuser_locations": [
        { "x": <number>, "y": <number>, "type": "<string>" }
      ]
    }
  ]
}

If no RCP data found, return: { "rooms": [] }`;

const DUCT_ROUTING_PROMPT = `You are analysing a mechanical plan drawing to trace duct routing.
The drawing scale factor is {SCALE} (1 drawing unit = {SCALE} real metres).

Your task is to trace EVERY visible duct run and extract its routing path.

Look for:
1. **Duct centerlines** with size annotations (e.g. "24x12", "600x300", or round "Ø12").
2. **Direction changes** - elbows, offsets, transitions.
3. **Size changes** - reducers/enlargements along the run.
4. **Branch takeoffs** from main trunks.
5. **Terminal connections** - diffusers, grilles, registers at end of runs.
6. **Equipment connections** - where ducts connect to AHUs, RTUs, VAVs, etc.
7. **Elevation annotations** - "T.O.D. 3200" (top of duct), "B.O.D. 2800" (bottom of duct), etc.

For each duct run, provide waypoints as x,y,z coordinates in real-world metres (bottom-left origin).
If the drawing is in imperial, convert to metric.

Return ONLY valid JSON (no markdown fences):
{
  "duct_runs": [
    {
      "duct_tag": "<string or 'UNTAGGED-N'>",
      "system": "<supply|return|exhaust|outside_air>",
      "routing": [
        { "x": <number>, "y": <number>, "z": <number>, "size": { "w": <mm>, "h": <mm> } }
      ],
      "fittings": [
        {
          "type": "<elbow|reducer|tee|wye|offset|transition|takeoff>",
          "position": { "x": <number>, "y": <number>, "z": <number> },
          "angle": <number|null>,
          "from": "<size string|null>",
          "to": "<size string|null>"
        }
      ],
      "connected_equipment": ["<equipment tag>"],
      "terminals": [
        { "type": "<diffuser|grille|register>", "tag": "<string>", "position": { "x": <number>, "y": <number>, "z": <number> } }
      ]
    }
  ]
}

If no duct routing is visible, return: { "duct_runs": [] }`;

// ---------------------------------------------------------------------------
// JSON response parsing helper
// ---------------------------------------------------------------------------

function parseJsonResponse<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract a JSON object if Claude added preamble text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        // fall through
      }
    }
    console.warn('[mep-schedule-extractor] Could not parse Claude response as JSON');
    return fallback;
  }
}

/** Call Claude vision with the given image content and prompt. */
async function callClaude(
  client: Anthropic,
  imageContent: any[],
  prompt: string,
  maxTokens = 4096,
): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [...imageContent, { type: 'text', text: prompt }],
      },
    ],
  });

  const textBlock = response.content.find((b: any) => b.type === 'text');
  return textBlock ? (textBlock as any).text : '';
}

// ---------------------------------------------------------------------------
// Validators / sanitisers
// ---------------------------------------------------------------------------

const VALID_DUCT_SYSTEMS = new Set(['supply', 'return', 'exhaust', 'outside_air']);
const VALID_PIPE_SYSTEMS = new Set([
  'chilled_water',
  'hot_water',
  'domestic_cold',
  'domestic_hot',
  'sanitary',
  'storm',
]);
const VALID_DUCT_SHAPES = new Set(['rectangular', 'round', 'oval']);

function sanitizeDuct(d: any, sourceDrawing: string): DuctScheduleEntry | null {
  if (!d || typeof d.tag !== 'string' || !d.tag.trim()) return null;

  const system = VALID_DUCT_SYSTEMS.has(d.system) ? d.system : 'supply';
  const shape = VALID_DUCT_SHAPES.has(d.shape) ? d.shape : 'rectangular';

  return {
    tag: d.tag.trim(),
    system,
    shape,
    width_mm: typeof d.width_mm === 'number' ? d.width_mm : null,
    height_mm: typeof d.height_mm === 'number' ? d.height_mm : null,
    diameter_mm: typeof d.diameter_mm === 'number' ? d.diameter_mm : null,
    cfm: typeof d.cfm === 'number' ? d.cfm : null,
    velocity_fpm: typeof d.velocity_fpm === 'number' ? d.velocity_fpm : null,
    static_pressure: typeof d.static_pressure === 'number' ? d.static_pressure : null,
    insulation: typeof d.insulation === 'string' ? d.insulation : null,
    material: typeof d.material === 'string' ? d.material : null,
    source_drawing: sourceDrawing,
  };
}

function sanitizePipe(p: any, sourceDrawing: string): PipeScheduleEntry | null {
  if (!p || typeof p.tag !== 'string' || !p.tag.trim()) return null;

  const system = VALID_PIPE_SYSTEMS.has(p.system) ? p.system : 'domestic_cold';

  return {
    tag: p.tag.trim(),
    system,
    diameter_mm: typeof p.diameter_mm === 'number' ? p.diameter_mm : null,
    material: typeof p.material === 'string' ? p.material : null,
    insulation: typeof p.insulation === 'string' ? p.insulation : null,
    routing: Array.isArray(p.routing) ? p.routing.map(sanitizeWaypoint).filter(Boolean) as Waypoint[] : [],
    source_drawing: sourceDrawing,
  };
}

function sanitizeWaypoint(wp: any): Waypoint | null {
  if (!wp || typeof wp.x !== 'number' || typeof wp.y !== 'number') return null;
  const result: Waypoint = {
    x: wp.x,
    y: wp.y,
    z: typeof wp.z === 'number' ? wp.z : 0,
  };
  if (wp.size) {
    if (typeof wp.size.w === 'number' && typeof wp.size.h === 'number') {
      result.size = { w: wp.size.w, h: wp.size.h };
    } else if (typeof wp.size.diameter === 'number') {
      result.size = { diameter: wp.size.diameter };
    }
  }
  return result;
}

function sanitizeFitting(f: any): Fitting | null {
  if (!f || typeof f.type !== 'string') return null;
  if (!f.position || typeof f.position.x !== 'number' || typeof f.position.y !== 'number') {
    return null;
  }
  return {
    type: f.type,
    position: {
      x: f.position.x,
      y: f.position.y,
      z: typeof f.position.z === 'number' ? f.position.z : 0,
    },
    angle: typeof f.angle === 'number' ? f.angle : undefined,
    from: typeof f.from === 'string' ? f.from : undefined,
    to: typeof f.to === 'string' ? f.to : undefined,
  };
}

function sanitizeTerminal(t: any): Terminal | null {
  if (!t || typeof t.type !== 'string') return null;
  if (!t.position || typeof t.position.x !== 'number' || typeof t.position.y !== 'number') {
    return null;
  }
  return {
    type: t.type,
    tag: typeof t.tag === 'string' ? t.tag : '',
    position: {
      x: t.position.x,
      y: t.position.y,
      z: typeof t.position.z === 'number' ? t.position.z : 0,
    },
  };
}

function sanitizeEquipment(e: any, sourceDrawing: string): EquipmentResult | null {
  if (!e || typeof e.tag !== 'string' || !e.tag.trim()) return null;

  const connections: EquipmentConnection[] = [];
  if (Array.isArray(e.connections)) {
    for (const c of e.connections) {
      if (c && typeof c.duct_tag === 'string') {
        connections.push({
          duct_tag: c.duct_tag,
          direction: typeof c.direction === 'string' ? c.direction : 'unknown',
          connection_point: typeof c.connection_point === 'string' ? c.connection_point : 'unknown',
        });
      }
    }
  }

  let location: { x: number; y: number } | null = null;
  if (e.location && typeof e.location.x === 'number' && typeof e.location.y === 'number') {
    location = { x: e.location.x, y: e.location.y };
  }

  const specs: Record<string, number | string> = {};
  if (e.specs && typeof e.specs === 'object') {
    for (const [k, v] of Object.entries(e.specs)) {
      if (typeof v === 'number' || typeof v === 'string') {
        specs[k] = v;
      }
    }
  }

  return {
    tag: e.tag.trim(),
    type: typeof e.type === 'string' ? e.type : 'other',
    location,
    connections,
    specs,
    source_drawing: sourceDrawing,
  };
}

function sanitizeRCPRoom(r: any, sourceDrawing: string): RCPResult | null {
  if (!r || typeof r.room_name !== 'string' || !r.room_name.trim()) return null;

  const diffusers: DiffuserLocation[] = [];
  if (Array.isArray(r.diffuser_locations)) {
    for (const d of r.diffuser_locations) {
      if (d && typeof d.x === 'number' && typeof d.y === 'number') {
        diffusers.push({
          x: d.x,
          y: d.y,
          type: typeof d.type === 'string' ? d.type : 'unknown',
        });
      }
    }
  }

  return {
    room_name: r.room_name.trim(),
    ceiling_height_m: typeof r.ceiling_height_m === 'number' ? r.ceiling_height_m : null,
    plenum_depth_m: typeof r.plenum_depth_m === 'number' ? r.plenum_depth_m : null,
    duct_mounting_height_m: typeof r.duct_mounting_height_m === 'number' ? r.duct_mounting_height_m : null,
    diffuser_locations: diffusers,
    source_drawing: sourceDrawing,
  };
}

// ---------------------------------------------------------------------------
// Public extraction functions
// ---------------------------------------------------------------------------

/**
 * Extract duct and pipe schedules from a mechanical drawing sheet.
 * Sends the drawing image to Claude and parses the returned schedule tables.
 */
export async function extractMEPSchedules(
  client: Anthropic,
  imageContent: any[],
  drawingId: string,
): Promise<MEPScheduleResult> {
  try {
    const raw = await callClaude(client, imageContent, SCHEDULE_EXTRACTION_PROMPT);

    const parsed = parseJsonResponse<{ ducts: any[]; pipes: any[] }>(raw, {
      ducts: [],
      pipes: [],
    });

    const ducts: DuctScheduleEntry[] = [];
    for (const d of parsed.ducts ?? []) {
      const sanitized = sanitizeDuct(d, drawingId);
      if (sanitized) ducts.push(sanitized);
    }

    const pipes: PipeScheduleEntry[] = [];
    for (const p of parsed.pipes ?? []) {
      const sanitized = sanitizePipe(p, drawingId);
      if (sanitized) pipes.push(sanitized);
    }

    return { ducts, pipes, drawing_id: drawingId, raw_response: raw };
  } catch (err: any) {
    console.error(
      `[mep-schedule-extractor] extractMEPSchedules failed for ${drawingId}:`,
      err?.message ?? err,
    );
    return { ducts: [], pipes: [], drawing_id: drawingId, raw_response: '' };
  }
}

/**
 * Extract duct routing (centerline paths, fittings, terminals) from a
 * mechanical plan drawing. The `scale` parameter is the real-world metres
 * per drawing unit (as returned by drawing-scale-extractor).
 */
export async function extractDuctRouting(
  client: Anthropic,
  imageContent: any[],
  drawingId: string,
  scale: number,
): Promise<DuctRoutingResult[]> {
  try {
    const prompt = DUCT_ROUTING_PROMPT
      .replace('{SCALE}', String(scale))
      .replace('{SCALE}', String(scale));

    const raw = await callClaude(client, imageContent, prompt, 8192);

    const parsed = parseJsonResponse<{ duct_runs: any[] }>(raw, { duct_runs: [] });

    const results: DuctRoutingResult[] = [];
    let untaggedCounter = 0;

    for (const run of parsed.duct_runs ?? []) {
      const tag =
        typeof run.duct_tag === 'string' && run.duct_tag.trim()
          ? run.duct_tag.trim()
          : `UNTAGGED-${++untaggedCounter}`;

      const system = VALID_DUCT_SYSTEMS.has(run.system) ? run.system : 'supply';

      const routing = Array.isArray(run.routing)
        ? (run.routing.map(sanitizeWaypoint).filter(Boolean) as Waypoint[])
        : [];

      const fittings = Array.isArray(run.fittings)
        ? (run.fittings.map(sanitizeFitting).filter(Boolean) as Fitting[])
        : [];

      const terminals = Array.isArray(run.terminals)
        ? (run.terminals.map(sanitizeTerminal).filter(Boolean) as Terminal[])
        : [];

      const connected_equipment = Array.isArray(run.connected_equipment)
        ? run.connected_equipment.filter((e: any) => typeof e === 'string')
        : [];

      if (routing.length > 0 || fittings.length > 0 || terminals.length > 0) {
        results.push({
          duct_tag: tag,
          system: system as DuctRoutingEntry['system'],
          routing,
          fittings,
          connected_equipment,
          terminals,
          source_drawing: drawingId,
        });
      }
    }

    return results;
  } catch (err: any) {
    console.error(
      `[mep-schedule-extractor] extractDuctRouting failed for ${drawingId}:`,
      err?.message ?? err,
    );
    return [];
  }
}

/**
 * Extract room ceiling heights, plenum depths, and diffuser locations from
 * a Reflected Ceiling Plan (RCP) drawing.
 */
export async function extractRCPElevations(
  client: Anthropic,
  imageContent: any[],
  drawingId: string,
): Promise<RCPResult[]> {
  try {
    const raw = await callClaude(client, imageContent, RCP_EXTRACTION_PROMPT);

    const parsed = parseJsonResponse<{ rooms: any[] }>(raw, { rooms: [] });

    const results: RCPResult[] = [];
    for (const r of parsed.rooms ?? []) {
      const sanitized = sanitizeRCPRoom(r, drawingId);
      if (sanitized) results.push(sanitized);
    }

    return results;
  } catch (err: any) {
    console.error(
      `[mep-schedule-extractor] extractRCPElevations failed for ${drawingId}:`,
      err?.message ?? err,
    );
    return [];
  }
}

/**
 * Extract equipment tags, connections, and specs from a mechanical plan.
 */
export async function extractEquipmentConnections(
  client: Anthropic,
  imageContent: any[],
  drawingId: string,
): Promise<EquipmentResult[]> {
  try {
    const raw = await callClaude(client, imageContent, EQUIPMENT_EXTRACTION_PROMPT);

    const parsed = parseJsonResponse<{ equipment: any[] }>(raw, { equipment: [] });

    const results: EquipmentResult[] = [];
    for (const e of parsed.equipment ?? []) {
      const sanitized = sanitizeEquipment(e, drawingId);
      if (sanitized) results.push(sanitized);
    }

    return results;
  } catch (err: any) {
    console.error(
      `[mep-schedule-extractor] extractEquipmentConnections failed for ${drawingId}:`,
      err?.message ?? err,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

/**
 * Combine outputs from all extraction passes into a single MEP model with
 * lookup maps for fast access by tag/room name.
 */
export function buildMEPModel(
  schedules: MEPScheduleResult,
  routing: DuctRoutingResult[],
  rcpData: RCPResult[],
  equipment: EquipmentResult[],
): MEPModelData {
  // Build duct lookup by tag
  const duct_lookup = new Map<string, DuctScheduleEntry>();
  for (const d of schedules.ducts) {
    duct_lookup.set(d.tag, d);
  }

  // Enrich routing entries that reference ducts without schedule data:
  // if routing found a duct tag not present in the schedule, create a
  // minimal schedule entry from the routing size data.
  for (const run of routing) {
    if (!duct_lookup.has(run.duct_tag) && run.routing.length > 0) {
      const firstWp = run.routing[0];
      const size = firstWp.size;
      let width: number | null = null;
      let height: number | null = null;
      let diameter: number | null = null;
      let shape: DuctScheduleEntry['shape'] = 'rectangular';

      if (size && 'w' in size) {
        width = size.w;
        height = size.h;
      } else if (size && 'diameter' in size) {
        diameter = size.diameter;
        shape = 'round';
      }

      const inferred: DuctScheduleEntry = {
        tag: run.duct_tag,
        system: run.system,
        shape,
        width_mm: width,
        height_mm: height,
        diameter_mm: diameter,
        cfm: null,
        velocity_fpm: null,
        static_pressure: null,
        insulation: null,
        material: null,
        source_drawing: run.source_drawing,
      };
      duct_lookup.set(run.duct_tag, inferred);
    }
  }

  // Build equipment lookup
  const equipment_lookup = new Map<string, EquipmentResult>();
  for (const e of equipment) {
    equipment_lookup.set(e.tag, e);
  }

  // Build room elevation lookup from RCP data
  const room_elevations = new Map<
    string,
    { ceiling_m: number; duct_mounting_m: number }
  >();
  for (const r of rcpData) {
    const ceiling = r.ceiling_height_m ?? 2.74; // fallback only if RCP had no value
    const ductMount = r.duct_mounting_height_m ?? ceiling + (r.plenum_depth_m ?? 0.3);
    room_elevations.set(r.room_name, {
      ceiling_m: ceiling,
      duct_mounting_m: ductMount,
    });
  }

  return {
    ducts: Array.from(duct_lookup.values()),
    pipes: schedules.pipes,
    duct_routing: routing,
    rcp: rcpData,
    equipment,
    duct_lookup,
    equipment_lookup,
    room_elevations,
  };
}
