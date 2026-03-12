// server/services/rates.ts
// =============================================================================
// SIMPLE RATE PROFILES — ONTARIO ICI MARKET (CAD)
// =============================================================================
//
// Purpose:
//   Fast keyword-match rate lookup for BIM element costing.
//   Rates are all-in (supply + install, direct cost only).
//   Currency: CAD. Base region: Ontario GTA — apply regional factor from
//   canadian-cost-data.ts for non-GTA projects.
//
// Overhead & Profit NOT included — applied by ohp-configuration.ts.
//
// For full MEP itemized rates see:
//   server/estimator/ontario-mep-rates.ts  (Divisions 21/22/23/26/27/28)
//
// Calibration: Q1 2026 Ontario ICI market
//   Structural concrete: Altus Group Canadian Cost Guide 2025
//   Wood framing: OHBA / BCIN contractor surveys 2025
//   Roofing: RSMeans Canadian 2025 + OIRCA market check
//   Finishes: RSMeans Canadian 2025
//   MEP budget rates: UA/IBEW collective agreement basis; see ontario-mep-rates.ts
//
// Overridable at runtime via COST_RATES_JSON environment variable.
// =============================================================================

type Unit = "m" | "m2" | "m3" | "ea" | "ft" | "ft2" | "ft3";
export type RateRule = { match: string; unit: Unit; rate: number; note?: string };
export type RateProfile = { name: string; currency: string; units: "metric" | "imperial"; rules: RateRule[] };

const DEFAULT_METRIC: RateProfile = {
  name: "ontario-gta-metric",
  currency: "CAD",
  units: "metric",
  rules: [
    // Structural / Concrete
    { match: "SLAB_ON_GRADE",   unit: "m2",  rate: 185,    note: "200mm SOG, ready-mix, vapour barrier, mesh" },
    { match: "SLAB",            unit: "m3",  rate: 580,    note: "Elevated slab, 30MPa, rebar, forming" },
    { match: "FOUNDATION",      unit: "m3",  rate: 620,    note: "Foundation wall/footing, 30MPa, rebar" },
    { match: "FOOTING",         unit: "m3",  rate: 540,    note: "Isolated footing, 30MPa, rebar" },
    { match: "COLUMN_CONCRETE", unit: "m3",  rate: 980,    note: "CIP column, 35MPa, rebar, forming" },
    { match: "BEAM_CONCRETE",   unit: "m3",  rate: 920,    note: "CIP beam, 35MPa, rebar, forming" },
    { match: "BEAM_STEEL",      unit: "m3",  rate: 4200,   note: "W-section fabricated & erected" },
    { match: "COLUMN_STEEL",    unit: "m3",  rate: 4500,   note: "W-section fabricated & erected" },
    { match: "STEEL_DECK",      unit: "m2",  rate: 85,     note: "38mm galvanized composite deck" },
    { match: "METAL_STUD",      unit: "m2",  rate: 68,     note: "92mm 20-ga stud framing @400mm OC" },
    { match: "BEAM",            unit: "m3",  rate: 920,    note: "Structural beam (default)" },
    { match: "COLUMN",          unit: "m3",  rate: 980,    note: "Structural column (default)" },
    // Masonry
    { match: "MASONRY",         unit: "m2",  rate: 280,    note: "Brick veneer 90mm, mortar, ties" },
    { match: "CMU",             unit: "m2",  rate: 195,    note: "200mm hollow CMU" },
    { match: "BLOCK",           unit: "m2",  rate: 195,    note: "200mm block" },
    // Wood
    { match: "WOOD_FRAME",      unit: "m2",  rate: 92,     note: "38x140 stud @400mm OC + plates" },
    { match: "ENGINEERED_WOOD", unit: "m3",  rate: 2800,   note: "LVL/PSL/LSL" },
    { match: "GLULAM",          unit: "m3",  rate: 4200,   note: "GLT fabricated & erected" },
    // Envelope
    { match: "CURTAIN_WALL",    unit: "m2",  rate: 850,    note: "Unitized commercial curtain wall" },
    { match: "FACADE",          unit: "m2",  rate: 420,    note: "Aluminium framing + glazing cladding" },
    { match: "CLADDING",        unit: "m2",  rate: 165,    note: "Fibre cement / vinyl panel" },
    { match: "WALL_EXTERIOR",   unit: "m2",  rate: 245,    note: "Insulated exterior wall assembly" },
    { match: "WALL_INTERIOR",   unit: "m2",  rate: 95,     note: "Interior 92mm stud + drywall 2 sides" },
    { match: "WALL",            unit: "m2",  rate: 145,    note: "Wall assembly (default)" },
    // Thermal / Moisture
    { match: "INSULATION_BATT", unit: "m2",  rate: 28,     note: "RSI-3.87 batt" },
    { match: "INSULATION_RIGID",unit: "m2",  rate: 42,     note: "75mm XPS board" },
    { match: "INSULATION_SPRAY",unit: "m2",  rate: 65,     note: "75mm closed-cell SPF" },
    { match: "ROOFING_SBS",     unit: "m2",  rate: 155,    note: "2-ply SBS mod-bit, R-20 iso" },
    { match: "ROOFING",         unit: "m2",  rate: 185,    note: "60mm TPO mechanically attached, R-20 iso" },
    { match: "WATERPROOFING",   unit: "m2",  rate: 88,     note: "Sheet-applied membrane, below grade" },
    { match: "AIR_BARRIER",     unit: "m2",  rate: 22,     note: "Self-adhered air barrier" },
    // Openings
    { match: "WINDOW_FIXED",    unit: "m2",  rate: 580,    note: "Fixed window by area, double-glazed" },
    { match: "WINDOW",          unit: "ea",  rate: 1450,   note: "Vinyl casement 900x1200mm, argon" },
    { match: "DOOR_EXTERIOR",   unit: "ea",  rate: 2200,   note: "Exterior steel insulated, closer" },
    { match: "DOOR_GLASS",      unit: "ea",  rate: 3800,   note: "Full-height glass, aluminium frame" },
    { match: "DOOR_HOLLOW",     unit: "ea",  rate: 680,    note: "Hollow metal 900x2100mm" },
    { match: "DOOR_SOLID",      unit: "ea",  rate: 950,    note: "Solid wood flush door" },
    { match: "DOOR",            unit: "ea",  rate: 1100,   note: "Door assembly (default)" },
    { match: "GLAZING",         unit: "m2",  rate: 580,    note: "Glazing assembly (default)" },
    { match: "SKYLIGHT",        unit: "m2",  rate: 950,    note: "Curb-mounted double-glazed skylight" },
    // Finishes
    { match: "FLOORING_TILE",   unit: "m2",  rate: 145,    note: "Porcelain tile 300x300mm" },
    { match: "FLOORING_LVT",    unit: "m2",  rate: 88,     note: "LVT/LVP floating" },
    { match: "FLOORING_CARPET", unit: "m2",  rate: 72,     note: "Commercial broadloom" },
    { match: "FLOORING_WOOD",   unit: "m2",  rate: 145,    note: "Engineered hardwood 120mm" },
    { match: "FLOORING",        unit: "m2",  rate: 85,     note: "Flooring (default)" },
    { match: "DRYWALL",         unit: "m2",  rate: 52,     note: "16mm gypsum board, tape, prime-ready" },
    { match: "CEILING_GRID",    unit: "m2",  rate: 55,     note: "T-bar + 600x600mm acoustic tile" },
    { match: "CEILING_DRYWALL", unit: "m2",  rate: 72,     note: "Drywall ceiling, tape, prime-ready" },
    { match: "PAINTING",        unit: "m2",  rate: 18,     note: "2 coats latex roller" },
    // Stairs / Specialties
    { match: "STAIR_CONCRETE",  unit: "ea",  rate: 12500,  note: "Concrete stair flight 1800mm, ~12 risers" },
    { match: "STAIR_STEEL",     unit: "ea",  rate: 9500,   note: "Steel pan stair flight" },
    { match: "GUARDRAIL",       unit: "m",   rate: 380,    note: "SS cable or glass guardrail" },
    { match: "HANDRAIL",        unit: "m",   rate: 185,    note: "Powder-coated steel handrail" },
    { match: "ELEVATOR",        unit: "ea",  rate: 145000, note: "Hydraulic passenger elevator 3-stop — verify with vendor" },
    // Earthwork / Site
    { match: "EXCAVATION",      unit: "m3",  rate: 28,     note: "Bulk machine excavation, no rock" },
    { match: "BACKFILL",        unit: "m3",  rate: 22,     note: "Granular B backfill, compact" },
    { match: "GRAVEL",          unit: "m2",  rate: 38,     note: "300mm granular A, place, compact" },
    { match: "ASPHALT",         unit: "m2",  rate: 95,     note: "75mm HL-3, 150mm granular base" },
    { match: "CONCRETE_CURB",   unit: "m",   rate: 85,     note: "CIP curb 150x300mm" },
    // MEP summary rates (BIM keyword matching)
    { match: "DUCT",            unit: "m",   rate: 195,    note: "HVAC duct medium section avg. CAD (see ontario-mep-rates.ts for itemized)" },
    { match: "PIPE_SPRINKLER",  unit: "m",   rate: 95,     note: "Sprinkler pipe 25-40mm avg. CAD" },
    { match: "PIPE_HVAC",       unit: "m",   rate: 145,    note: "Hydronic pipe 32-50mm black steel avg. CAD" },
    { match: "PIPE_PLUMBING",   unit: "m",   rate: 110,    note: "Plumbing pipe 25-50mm copper/ABS avg. CAD" },
    { match: "PIPE",            unit: "m",   rate: 120,    note: "Pipe (default — specify discipline)" },
    { match: "TRAY",            unit: "m",   rate: 180,    note: "Cable tray 600mm ladder type CAD" },
    { match: "CONDUIT",         unit: "m",   rate: 58,     note: "EMT 25-38mm avg. CAD" },
    { match: "PANEL_ELECTRICAL",unit: "ea",  rate: 3800,   note: "Electrical panelboard 200A 3-phase CAD" },
    { match: "PANEL",           unit: "ea",  rate: 3800,   note: "Electrical panel (default) CAD" },
    { match: "FIXTURE_PLUMBING",unit: "ea",  rate: 950,    note: "Plumbing fixture avg. (toilet/lav weighted)" },
    { match: "FIXTURE_LIGHTING",unit: "ea",  rate: 220,    note: "Light fixture avg. (troffer/downlight weighted)" },
    { match: "FIXTURE",         unit: "ea",  rate: 280,    note: "Fixture (default)" },
    { match: "LIGHT",           unit: "ea",  rate: 220,    note: "LED light fixture avg. CAD" },
    { match: "SPRINKLER_HEAD",  unit: "ea",  rate: 65,     note: "Sprinkler head standard pendent CAD" },
  ],
};

const DEFAULT_IMPERIAL: RateProfile = {
  name: "ontario-gta-imperial",
  currency: "CAD",
  units: "imperial",
  rules: [
    { match: "SLAB",    unit: "ft3", rate: 16.40, note: "Elevated slab/ft3, 30MPa (CAD)" },
    { match: "BEAM",    unit: "ft3", rate: 26.05, note: "Beam/ft3 (CAD)" },
    { match: "COLUMN",  unit: "ft3", rate: 27.75, note: "Column/ft3 (CAD)" },
    { match: "FACADE",  unit: "ft2", rate: 39.00, note: "Curtain wall/cladding/ft2 (CAD)" },
    { match: "WALL",    unit: "ft2", rate: 13.50, note: "Wall assembly/ft2 (CAD)" },
    { match: "ROOFING", unit: "ft2", rate: 17.20, note: "TPO roofing/ft2 (CAD)" },
    { match: "FLOORING",unit: "ft2", rate: 7.90,  note: "Flooring avg./ft2 (CAD)" },
    { match: "DRYWALL", unit: "ft2", rate: 4.85,  note: "Drywall/ft2 (CAD)" },
    { match: "DUCT",    unit: "ft",  rate: 59.50, note: "HVAC duct/lf (CAD)" },
    { match: "PIPE",    unit: "ft",  rate: 36.60, note: "Pipe/lf avg. (CAD)" },
    { match: "TRAY",    unit: "ft",  rate: 54.90, note: "Cable tray/lf (CAD)" },
    { match: "CONDUIT", unit: "ft",  rate: 17.70, note: "EMT conduit/lf (CAD)" },
    { match: "PANEL",   unit: "ea",  rate: 3800,  note: "Electrical panel (CAD)" },
    { match: "FIXTURE", unit: "ea",  rate: 280,   note: "Fixture avg. (CAD)" },
    { match: "LIGHT",   unit: "ea",  rate: 220,   note: "LED light fixture (CAD)" },
  ],
};

function parseEnvProfile(): RateProfile | null {
  try {
    if (!process.env.COST_RATES_JSON) return null;
    const j = JSON.parse(process.env.COST_RATES_JSON);
    if (Array.isArray(j?.rules) && (j.units === "metric" || j.units === "imperial")) return j as RateProfile;
    return null;
  } catch { return null; }
}

export function getRateProfile(name?: string, units?: "metric" | "imperial"): RateProfile {
  const env = parseEnvProfile();
  if (env && (!units || env.units === units)) return env;
  if (units === "imperial") return DEFAULT_IMPERIAL;
  if (units === "metric")   return DEFAULT_METRIC;
  return DEFAULT_METRIC;
}

/**
 * Find the first rule whose match string is contained in typeOrCategory.
 * Returns null if no rule matches — callers must NOT use a silent fallback;
 * raise an RFI for unrecognised element types.
 */
export function pickRuleFor(typeOrCategory: string, profile: RateProfile): RateRule | null {
  const T = String(typeOrCategory || "").toUpperCase().replace(/[-\s]/g, "_");
  for (const r of profile.rules) {
    if (T.includes(String(r.match || "").toUpperCase())) return r;
  }
  // Trade-keyword secondary fallback
  if (/DUCT|HVAC|VAV|AHU|RTU/.test(T))
    return profile.rules.find(r => r.match === "DUCT") ?? null;
  if (/SPRINKLER/.test(T))
    return profile.rules.find(r => r.match === "PIPE_SPRINKLER") ?? profile.rules.find(r => r.match === "PIPE") ?? null;
  if (/PIPE|PLUMBING|DRAIN|VENT|WASTE|RISER/.test(T))
    return profile.rules.find(r => r.match === "PIPE") ?? null;
  if (/TRAY|CABLE_TRAY/.test(T))
    return profile.rules.find(r => r.match === "TRAY") ?? null;
  if (/CONDUIT|RACEWAY/.test(T))
    return profile.rules.find(r => r.match === "CONDUIT") ?? null;
  if (/PANEL|SWITCHGEAR|SWITCHBOARD/.test(T))
    return profile.rules.find(r => r.match === "PANEL") ?? null;
  if (/LIGHT|LUMINAIRE|DOWNLIGHT|TROFFER|SCONCE/.test(T))
    return profile.rules.find(r => r.match === "LIGHT") ?? null;
  if (/FIXTURE|LAVATORY|TOILET|SHOWER|SINK/.test(T))
    return profile.rules.find(r => r.match === "FIXTURE") ?? null;
  if (/SLAB|FLOOR_SLAB/.test(T))
    return profile.rules.find(r => r.match === "SLAB") ?? null;
  if (/COLUMN/.test(T))
    return profile.rules.find(r => r.match === "COLUMN") ?? null;
  if (/BEAM|LINTEL|HEADER|GIRDER/.test(T))
    return profile.rules.find(r => r.match === "BEAM") ?? null;
  if (/CURTAIN|GLAZING/.test(T))
    return profile.rules.find(r => r.match === "FACADE") ?? null;
  if (/WALL/.test(T))
    return profile.rules.find(r => r.match === "WALL") ?? null;
  if (/ROOF/.test(T))
    return profile.rules.find(r => r.match === "ROOFING") ?? null;
  return null;
}
