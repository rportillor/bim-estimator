/**
 * Extract building facts from a project's BIM models, elements, and analysis results
 * for use by the compliance rules engine.
 *
 * Facts are key-value pairs consumed by the JSON-Logic rules in the YAML rule packs.
 * We try to derive as many facts as possible from the stored data; facts that cannot
 * be determined are simply omitted so the rules engine skips the corresponding rules.
 */
import { storage } from "../storage";

export async function extractProjectFacts(projectId: string): Promise<Record<string, any>> {
  const facts: Record<string, any> = {};

  // ── 1. Project-level data ─────────────────────────────────────────────────
  const project = await storage.getProject(projectId);
  if (!project) {
    console.warn(`extractProjectFacts: project ${projectId} not found`);
    return facts;
  }

  if (project.type) facts.occupancy_use = project.type;
  if (project.country) facts.jurisdiction = project.country;
  if (project.federalCode) facts.federal_code = project.federalCode;
  if (project.buildingArea) facts.building_area_m2 = Number(project.buildingArea);
  if (project.buildingClass) facts.building_class = project.buildingClass;

  // ── 2. BIM models & elements ──────────────────────────────────────────────
  const models = await storage.getBimModels(projectId);
  if (models.length === 0) {
    console.info(`extractProjectFacts: no BIM models for project ${projectId}`);
    return facts;
  }

  // Gather all elements across models
  const allElements: any[] = [];
  for (const model of models) {
    const elements = await storage.getBimElements(model.id);
    allElements.push(...elements);
  }

  // ── Derive dimensional facts from elements ────────────────────────────────

  // Building height: max elevation among all elements
  const elevations = allElements
    .filter(e => e.elevation != null)
    .map(e => Number(e.elevation));
  if (elevations.length > 0) {
    const maxElev = Math.max(...elevations);
    facts.building_height_m = maxElev / 1000; // elevation stored in mm
    facts.building_height_ft = facts.building_height_m * 3.28084;
  }

  // Storeys
  const storeys = new Set(allElements.map(e => e.storeyName).filter(Boolean));
  facts.building_storeys = storeys.size;
  facts.building_stories = storeys.size;

  // Area (from project or bounding box)
  if (models[0]?.boundingBox) {
    const bb = models[0].boundingBox as any;
    if (bb.min && bb.max) {
      const dx = (bb.max[0] - bb.min[0]) / 1000; // mm → m
      const dy = (bb.max[1] - bb.min[1]) / 1000;
      if (!facts.building_area_m2 && dx > 0 && dy > 0) {
        facts.building_area_m2 = Math.round(dx * dy * 100) / 100;
      }
    }
  }
  if (facts.building_area_m2) {
    facts.building_area_sqft = Math.round(facts.building_area_m2 * 10.7639);
    facts.fire_area_m2 = facts.building_area_m2; // default: whole floor = fire area
    facts.fire_area_sqft = facts.building_area_sqft;
    facts.floor_area_sqft = facts.building_area_sqft;
  }

  // ── Element-type flags & counts ───────────────────────────────────────────
  const typeSet = new Set(allElements.map(e => (e.elementType || "").toLowerCase()));
  const propsList = allElements.map(e => (e.properties || {}) as Record<string, any>);

  facts.has_elevator = typeSet.has("elevator") || typeSet.has("ifctransportelement");
  facts.has_ramp = typeSet.has("ramp") || typeSet.has("ifcramp");
  facts.has_fire_alarm = propsList.some(p => p.fire_alarm || p.has_fire_alarm);

  // Sprinkler info
  const sprinklerEl = allElements.find(e =>
    (e.elementType || "").toLowerCase().includes("sprinkler") ||
    (e.properties as any)?.sprinklered === true
  );
  facts.sprinklered = !!sprinklerEl;
  if (sprinklerEl?.properties?.sprinkler_standard) {
    facts.sprinkler_standard = (sprinklerEl.properties as any).sprinkler_standard;
  }

  // Exits
  const exitElements = allElements.filter(e => {
    const t = (e.elementType || "").toLowerCase();
    const p = (e.properties || {}) as any;
    return t.includes("exit") || p.is_exit === true || p.is_exit_door === true;
  });
  if (exitElements.length > 0) {
    facts.number_of_exits = exitElements.length;
  }

  // Doors
  const doors = allElements.filter(e => (e.elementType || "").toLowerCase().includes("door"));
  if (doors.length > 0) {
    // Min door width from properties
    const widths = doors
      .map(d => (d.properties as any)?.width_mm || (d.properties as any)?.width)
      .filter(Boolean)
      .map(Number);
    if (widths.length > 0) {
      facts.min_door_width_mm = Math.min(...widths);
      facts.door_width_inches = Math.round(facts.min_door_width_mm / 25.4 * 10) / 10;
    }
  }

  // Corridors
  const corridors = allElements.filter(e => (e.elementType || "").toLowerCase().includes("corridor"));
  if (corridors.length > 0) {
    const cWidths = corridors
      .map(c => (c.properties as any)?.width_mm || (c.properties as any)?.width)
      .filter(Boolean)
      .map(Number);
    if (cWidths.length > 0) {
      facts.corridor_width_mm = Math.min(...cWidths);
    }
  }

  // Stairs
  const stairs = allElements.filter(e => (e.elementType || "").toLowerCase().includes("stair"));
  if (stairs.length > 0) {
    const sWidths = stairs
      .map(s => (s.properties as any)?.width_mm || (s.properties as any)?.width)
      .filter(Boolean)
      .map(Number);
    if (sWidths.length > 0) {
      facts.stair_width_mm = Math.min(...sWidths);
      facts.stair_width_inches = Math.round(facts.stair_width_mm / 25.4 * 10) / 10;
    }
  }

  // ── Fire ratings from element properties ──────────────────────────────────
  for (const props of propsList) {
    if (props.floor_fire_rating_hours != null && facts.floor_fire_rating_hours == null) {
      facts.floor_fire_rating_hours = Number(props.floor_fire_rating_hours);
    }
    if (props.structural_fire_rating_hours != null && facts.structural_fire_rating_hours == null) {
      facts.structural_fire_rating_hours = Number(props.structural_fire_rating_hours);
    }
    if (props.fire_separation_rating_hours != null && facts.fire_separation_rating_hours == null) {
      facts.fire_separation_rating_hours = Number(props.fire_separation_rating_hours);
    }
    if (props.exit_fire_rating_hours != null && facts.exit_fire_rating_hours == null) {
      facts.exit_fire_rating_hours = Number(props.exit_fire_rating_hours);
    }
    if (props.exterior_wall_rating_hours != null && facts.exterior_wall_rating_hours == null) {
      facts.exterior_wall_rating_hours = Number(props.exterior_wall_rating_hours);
    }
    if (props.fire_barrier_rating_hours != null && facts.fire_barrier_rating_hours == null) {
      facts.fire_barrier_rating_hours = Number(props.fire_barrier_rating_hours);
    }
    if (props.elevator_shaft_fire_rating_hours != null && facts.elevator_shaft_fire_rating_hours == null) {
      facts.elevator_shaft_fire_rating_hours = Number(props.elevator_shaft_fire_rating_hours);
    }
  }

  // ── Structural material facts ─────────────────────────────────────────────
  for (const props of propsList) {
    if (props.concrete_fc_MPa != null && facts.concrete_fc_MPa == null) {
      facts.concrete_fc_MPa = Number(props.concrete_fc_MPa);
      facts.concrete_strength_MPa = facts.concrete_fc_MPa;
    }
    if (props.steel_yield_strength_MPa != null && facts.steel_yield_strength_MPa == null) {
      facts.steel_yield_strength_MPa = Number(props.steel_yield_strength_MPa);
    }
    if (props.rebar_yield_strength_MPa != null && facts.rebar_yield_strength_MPa == null) {
      facts.rebar_yield_strength_MPa = Number(props.rebar_yield_strength_MPa);
    }
    if (props.reinforcement_ratio != null && facts.reinforcement_ratio == null) {
      facts.reinforcement_ratio = Number(props.reinforcement_ratio);
    }
    if (props.concrete_cover_mm != null && facts.concrete_cover_mm == null) {
      facts.concrete_cover_mm = Number(props.concrete_cover_mm);
    }
    if (props.exposure_class != null && facts.exposure_class == null) {
      facts.exposure_class = props.exposure_class;
    }
    if (props.construction_type != null && facts.construction_type == null) {
      facts.construction_type = props.construction_type;
    }
    if (props.occupancy_group != null && facts.occupancy_group == null) {
      facts.occupancy_group = props.occupancy_group;
    }
    if (props.occupancy_classification != null && facts.occupancy_classification == null) {
      facts.occupancy_classification = props.occupancy_classification;
    }
  }

  // ── Occupancy & mixed-use ─────────────────────────────────────────────────
  const occupancyGroups = new Set(propsList.map(p => p.occupancy_group).filter(Boolean));
  facts.has_mixed_occupancy = occupancyGroups.size > 1;

  // ── Accessibility facts ───────────────────────────────────────────────────
  const entrances = allElements.filter(e =>
    (e.elementType || "").toLowerCase().includes("entrance") ||
    (e.properties as any)?.is_entrance === true
  );
  facts.number_of_entrances = entrances.length;
  facts.has_barrier_free_entrance = entrances.some(e => (e.properties as any)?.barrier_free === true);
  facts.has_accessible_route = facts.has_ramp || facts.has_elevator || facts.has_barrier_free_entrance;

  // Barrier-free path width
  const bfPaths = allElements.filter(e => (e.properties as any)?.barrier_free_path_width_mm);
  if (bfPaths.length > 0) {
    facts.barrier_free_path_width_mm = Math.min(
      ...bfPaths.map(e => Number((e.properties as any).barrier_free_path_width_mm))
    );
  }

  // ── Pass-through: any explicitly-stored compliance facts from analysis ────
  // BIM models may have metadata.complianceFacts set by the generation step
  for (const model of models) {
    const meta = (model.metadata || {}) as Record<string, any>;
    if (meta.complianceFacts && typeof meta.complianceFacts === "object") {
      Object.assign(facts, meta.complianceFacts);
    }
  }

  // ── Structural system defaults based on element types ─────────────────────
  if (!facts.structural_system) {
    if (typeSet.has("steelbeam") || typeSet.has("steelcolumn") || allElements.some(e => (e.material || "").toLowerCase().includes("steel"))) {
      facts.structural_system = "steel_frame";
      facts.structural_steel_grade = facts.structural_steel_grade || "CSA G40.21 350W";
    } else if (allElements.some(e => (e.material || "").toLowerCase().includes("concrete"))) {
      facts.structural_system = "reinforced_concrete";
    } else if (allElements.some(e => (e.material || "").toLowerCase().includes("wood"))) {
      facts.structural_system = "wood_frame";
    }
  }

  // Log coverage
  const factCount = Object.keys(facts).length;
  console.log(`📊 extractProjectFacts: ${factCount} facts extracted for project ${projectId}`);

  return facts;
}
