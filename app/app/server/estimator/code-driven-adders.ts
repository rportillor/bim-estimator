// server/estimator/code-driven-adders.ts
// =============================================================================
// CODE-DRIVEN COST ADDERS + QA/QC TESTING REQUIREMENTS
// =============================================================================
//
// Closes QS Level 5 gaps:
//   2.1  Code-Driven Cost Adders (fire rating, seismic, energy, accessibility)
//   2.3  QA/QC Testing Requirements (auto-generated from code register)
//
// Applied AFTER base QTO — tracked separately for transparency.
// Canadian codes: NBC 2020 / OBC 2024, CSA standards, NECB, AODA
//
// Consumes: EstimateSummary from estimate-engine.ts
// Consumed by: budget-structure.ts (Layer 2 enhancement), qs-level5-routes.ts
// =============================================================================

import type { EstimateSummary } from './estimate-engine';


// ─── CODE ADDER TYPES ───────────────────────────────────────────────────────

export type CodeCategory =
  | 'fire_rating'
  | 'seismic'
  | 'energy'
  | 'accessibility'
  | 'structural'
  | 'environmental';

export interface CodeAdder {
  id: string;
  code: string;              // e.g., "OBC 3.2.2" or "NECB 2020"
  requirement: string;       // Human-readable description
  category: CodeCategory;
  affectedCSI: string[];     // CSI divisions this adder applies to
  costType: 'multiplier' | 'flat_per_m2' | 'flat_lump';
  multiplier?: number;       // e.g., 0.15 = +15%
  flatCostPerM2?: number;    // $/m² of affected area
  flatLumpSum?: number;      // $ fixed cost
  appliedAmount: number;     // computed $ after application
  notes: string;
}

export interface CodeAdderConfig {
  projectId: string;
  buildingType: 'residential' | 'commercial' | 'institutional' | 'industrial' | 'mixed';
  occupancyClassification: string;  // OBC classification (e.g., "C - Residential")
  fireRating: '0hr' | '45min' | '1hr' | '1.5hr' | '2hr';
  seismicCategory: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  energyCode: 'NECB_2020' | 'SB12' | 'OBC_12';
  accessibilityCode: 'AODA' | 'CSA_B651';
  grossFloorArea: number;    // m²
  numberOfStoreys: number;
  constructionType: 'combustible' | 'non_combustible' | 'heavy_timber';
}

export interface QATestingItem {
  id: string;
  description: string;
  code: string;              // Governing code
  standard: string;          // Test standard (e.g., "ASTM E2357")
  csiDivision: string;
  frequency: string;         // e.g., "1 per 75 m³"
  estimatedQuantity: number;
  unitCost: number;          // $/test
  totalCost: number;
  notes: string;
}

export interface CodeAdderResult {
  projectId: string;
  config: CodeAdderConfig;
  adders: CodeAdder[];
  qaTestingItems: QATestingItem[];
  totalAdderCost: number;
  totalQATestingCost: number;
  grandTotal: number;
  adderPercentOfDirect: number;
  generatedAt: string;
}


// ─── FIRE RATING ADDERS ────────────────────────────────────────────────────

function getFireRatingAdders(config: CodeAdderConfig, directCostByDiv: Map<string, number>): CodeAdder[] {
  const adders: CodeAdder[] = [];
  const rating = config.fireRating;

  if (rating === '0hr') return adders;

  // Fire-rated assemblies add cost to envelope and interior partitions
  const fireMultipliers: Record<string, number> = {
    '45min': 0.08, '1hr': 0.15, '1.5hr': 0.20, '2hr': 0.25,
  };
  const mult = fireMultipliers[rating] ?? 0;

  // Div 07 (envelope) and Div 09 (finishes/partitions) affected
  const affectedDivs = ['07', '09'];
  for (const div of affectedDivs) {
    const baseCost = directCostByDiv.get(div) ?? 0;
    if (baseCost <= 0) continue;
    adders.push({
      id: `FIRE-${div}-${rating}`,
      code: `OBC 3.2.2 / ASTM E119`,
      requirement: `${rating} fire-rated assemblies — Div ${div}`,
      category: 'fire_rating',
      affectedCSI: [div],
      costType: 'multiplier',
      multiplier: mult,
      appliedAmount: Math.round(baseCost * mult * 100) / 100,
      notes: `${rating} rating adds ${(mult * 100).toFixed(0)}% to Div ${div} base cost of $${baseCost.toFixed(2)}`,
    });
  }

  // Firestopping — per floor area
  if (rating !== '45min') {
    adders.push({
      id: `FIRE-STOP`,
      code: 'OBC 3.1.9 / CAN/ULC S115',
      requirement: 'Firestopping at rated assemblies — penetrations and joints',
      category: 'fire_rating',
      affectedCSI: ['07'],
      costType: 'flat_per_m2',
      flatCostPerM2: rating === '2hr' ? 12.50 : 8.75,
      appliedAmount: Math.round(config.grossFloorArea * (rating === '2hr' ? 12.50 : 8.75) * 100) / 100,
      notes: `Firestopping @ $${rating === '2hr' ? '12.50' : '8.75'}/m² × ${config.grossFloorArea} m² GFA`,
    });
  }

  return adders;
}


// ─── SEISMIC ADDERS ─────────────────────────────────────────────────────────

function getSeismicAdders(config: CodeAdderConfig, directCostByDiv: Map<string, number>): CodeAdder[] {
  const adders: CodeAdder[] = [];
  const cat = config.seismicCategory;

  // Only categories C+ have significant cost impact
  if (cat === 'A' || cat === 'B') return adders;

  const seismicMultipliers: Record<string, number> = {
    'C': 0.05, 'D': 0.10, 'E': 0.12, 'F': 0.15,
  };
  const mult = seismicMultipliers[cat] ?? 0;

  // Structural divisions affected: Div 03 (concrete), Div 05 (metals)
  const affectedDivs = ['03', '05'];
  for (const div of affectedDivs) {
    const baseCost = directCostByDiv.get(div) ?? 0;
    if (baseCost <= 0) continue;
    adders.push({
      id: `SEISMIC-${div}-${cat}`,
      code: `NBC 4.1.8 / CSA A23.3 / CSA S16`,
      requirement: `Seismic Category ${cat} — structural reinforcement Div ${div}`,
      category: 'seismic',
      affectedCSI: [div],
      costType: 'multiplier',
      multiplier: mult,
      appliedAmount: Math.round(baseCost * mult * 100) / 100,
      notes: `Seismic Cat ${cat} adds ${(mult * 100).toFixed(0)}% to Div ${div} structural cost`,
    });
  }

  // Non-structural seismic bracing (Div 23 HVAC, Div 26 Electrical)
  if (cat === 'D' || cat === 'E' || cat === 'F') {
    for (const div of ['23', '26']) {
      const baseCost = directCostByDiv.get(div) ?? 0;
      if (baseCost <= 0) continue;
      adders.push({
        id: `SEISMIC-BRACE-${div}`,
        code: 'CSA S832 / NBC 4.1.8.18',
        requirement: `Non-structural seismic bracing — Div ${div}`,
        category: 'seismic',
        affectedCSI: [div],
        costType: 'multiplier',
        multiplier: 0.03,
        appliedAmount: Math.round(baseCost * 0.03 * 100) / 100,
        notes: `MEP seismic bracing +3% to Div ${div}`,
      });
    }
  }

  return adders;
}


// ─── ENERGY CODE ADDERS ─────────────────────────────────────────────────────

function getEnergyAdders(config: CodeAdderConfig, directCostByDiv: Map<string, number>): CodeAdder[] {
  const adders: CodeAdder[] = [];

  // Div 07 — enhanced insulation to meet NECB/SB-12
  const div07Base = directCostByDiv.get('07') ?? 0;
  if (div07Base > 0) {
    const insulationPremium = config.energyCode === 'NECB_2020' ? 0.12 : 0.08;
    adders.push({
      id: 'ENERGY-INSUL',
      code: config.energyCode === 'NECB_2020' ? 'NECB 2020 3.2' : 'OBC SB-12 2.1',
      requirement: 'Enhanced thermal envelope insulation per energy code',
      category: 'energy',
      affectedCSI: ['07'],
      costType: 'multiplier',
      multiplier: insulationPremium,
      appliedAmount: Math.round(div07Base * insulationPremium * 100) / 100,
      notes: `Energy code insulation premium +${(insulationPremium * 100).toFixed(0)}% to Div 07`,
    });
  }

  // Div 08 — high-performance glazing
  const div08Base = directCostByDiv.get('08') ?? 0;
  if (div08Base > 0) {
    adders.push({
      id: 'ENERGY-GLAZE',
      code: config.energyCode === 'NECB_2020' ? 'NECB 2020 3.2.2' : 'OBC SB-12 2.1.2',
      requirement: 'High-performance glazing (low-E, triple pane) per energy code',
      category: 'energy',
      affectedCSI: ['08'],
      costType: 'multiplier',
      multiplier: 0.18,
      appliedAmount: Math.round(div08Base * 0.18 * 100) / 100,
      notes: 'Energy code glazing upgrade +18% to Div 08',
    });
  }

  // Div 23 — high-efficiency HVAC
  const div23Base = directCostByDiv.get('23') ?? 0;
  if (div23Base > 0) {
    adders.push({
      id: 'ENERGY-HVAC',
      code: config.energyCode === 'NECB_2020' ? 'NECB 2020 5.2' : 'OBC SB-12 3.1',
      requirement: 'High-efficiency HVAC equipment per energy code',
      category: 'energy',
      affectedCSI: ['23'],
      costType: 'multiplier',
      multiplier: 0.10,
      appliedAmount: Math.round(div23Base * 0.10 * 100) / 100,
      notes: 'Energy code HVAC efficiency premium +10% to Div 23',
    });
  }

  // Commissioning (Cx) — ASHRAE Guideline 0
  adders.push({
    id: 'ENERGY-CX',
    code: 'ASHRAE Guideline 0 / NECB 8.4',
    requirement: 'Building commissioning — energy systems verification',
    category: 'energy',
    affectedCSI: ['01', '23', '26'],
    costType: 'flat_per_m2',
    flatCostPerM2: 6.50,
    appliedAmount: Math.round(config.grossFloorArea * 6.50 * 100) / 100,
    notes: `Commissioning @ $6.50/m² × ${config.grossFloorArea} m² GFA`,
  });

  return adders;
}


// ─── ACCESSIBILITY ADDERS (AODA / CSA B651) ─────────────────────────────────

function getAccessibilityAdders(config: CodeAdderConfig, directCostByDiv: Map<string, number>): CodeAdder[] {
  const adders: CodeAdder[] = [];

  // Div 14 — elevator accessibility upgrades
  const div14Base = directCostByDiv.get('14') ?? 0;
  if (div14Base > 0 || config.numberOfStoreys >= 2) {
    adders.push({
      id: 'ACCESS-ELEV',
      code: 'AODA 80.21 / OBC 3.8',
      requirement: 'Accessible elevator — Braille buttons, audible indicators, cab size',
      category: 'accessibility',
      affectedCSI: ['14'],
      costType: 'flat_lump',
      flatLumpSum: 15000,
      appliedAmount: 15000,
      notes: 'Accessible elevator upgrade (Braille, audio, cab dimensions) per AODA',
    });
  }

  // Div 10 — signage (tactile, Braille)
  adders.push({
    id: 'ACCESS-SIGN',
    code: 'AODA 80.17 / CSA B651-18',
    requirement: 'Accessible signage — tactile lettering, Braille, high-contrast',
    category: 'accessibility',
    affectedCSI: ['10'],
    costType: 'flat_per_m2',
    flatCostPerM2: 2.50,
    appliedAmount: Math.round(config.grossFloorArea * 2.50 * 100) / 100,
    notes: `Accessible signage @ $2.50/m² × ${config.grossFloorArea} m² GFA`,
  });

  // Div 32 — accessible site features (ramps, tactile surfaces, parking)
  const div32Base = directCostByDiv.get('32') ?? 0;
  if (div32Base > 0) {
    adders.push({
      id: 'ACCESS-SITE',
      code: 'AODA Design of Public Spaces / OBC 3.8.3',
      requirement: 'Accessible site features — ramps, tactile walking surfaces, accessible parking',
      category: 'accessibility',
      affectedCSI: ['32'],
      costType: 'multiplier',
      multiplier: 0.06,
      appliedAmount: Math.round(div32Base * 0.06 * 100) / 100,
      notes: 'Site accessibility upgrades +6% to Div 32',
    });
  }

  // Div 22 — accessible plumbing fixtures
  const div22Base = directCostByDiv.get('22') ?? 0;
  if (div22Base > 0) {
    adders.push({
      id: 'ACCESS-PLUMB',
      code: 'OBC 3.8.3.12 / CSA B651-18',
      requirement: 'Accessible plumbing fixtures — wheelchair clearances, lever hardware',
      category: 'accessibility',
      affectedCSI: ['22'],
      costType: 'multiplier',
      multiplier: 0.04,
      appliedAmount: Math.round(div22Base * 0.04 * 100) / 100,
      notes: 'Accessible fixture upgrades +4% to Div 22',
    });
  }

  return adders;
}


// ─── QA/QC TESTING REQUIREMENTS ─────────────────────────────────────────────

function generateQATestingItems(config: CodeAdderConfig, estimate: EstimateSummary): QATestingItem[] {
  const items: QATestingItem[] = [];

  // Concrete testing — CSA A23.1 (1 test per 75 m³, min 1 per pour)
  const concreteItems = estimate.floors.flatMap(f => f.lineItems.filter(li => li.csiDivision === '03' && li.unit === 'm³'));
  const totalConcreteVolume = concreteItems.reduce((s, li) => s + li.quantity, 0);
  if (totalConcreteVolume > 0) {
    const numTests = Math.max(Math.ceil(totalConcreteVolume / 75), 3);
    items.push({
      id: 'QA-CONC-CYL',
      description: 'Concrete cylinder testing (compressive strength) — 3 cylinders per set',
      code: 'CSA A23.1-19 Table 26',
      standard: 'CSA A23.2-9C',
      csiDivision: '01',
      frequency: `1 set per 75 m³ (${totalConcreteVolume.toFixed(0)} m³ total)`,
      estimatedQuantity: numTests,
      unitCost: 185,
      totalCost: numTests * 185,
      notes: `${numTests} sets × $185/set = $${(numTests * 185).toLocaleString()}`,
    });

    // Slump testing
    items.push({
      id: 'QA-CONC-SLUMP',
      description: 'Concrete slump test — every load or as directed',
      code: 'CSA A23.1-19',
      standard: 'CSA A23.2-5C',
      csiDivision: '01',
      frequency: `1 per load, estimated ${Math.ceil(totalConcreteVolume / 8)} loads`,
      estimatedQuantity: Math.ceil(totalConcreteVolume / 8),
      unitCost: 45,
      totalCost: Math.ceil(totalConcreteVolume / 8) * 45,
      notes: `${Math.ceil(totalConcreteVolume / 8)} truck loads × $45/test`,
    });
  }

  // Structural steel inspection — CSA W59 / W47.1
  const steelItems = estimate.floors.flatMap(f => f.lineItems.filter(li => li.csiDivision === '05'));
  if (steelItems.length > 0) {
    const steelWeight = steelItems.reduce((s, li) => s + li.quantity, 0);
    const inspectionDays = Math.max(Math.ceil(steelWeight / 5000), 2);
    items.push({
      id: 'QA-STEEL-WELD',
      description: 'Structural steel weld inspection — CWB inspector',
      code: 'CSA W59-18 / CSA W47.1',
      standard: 'CSA W178.2',
      csiDivision: '01',
      frequency: `${inspectionDays} inspection days based on ${steelWeight.toFixed(0)} kg`,
      estimatedQuantity: inspectionDays,
      unitCost: 950,
      totalCost: inspectionDays * 950,
      notes: `${inspectionDays} days × $950/day CWB inspector`,
    });

    // High-strength bolt testing
    items.push({
      id: 'QA-STEEL-BOLT',
      description: 'High-strength bolt tension testing (Skidmore gauge)',
      code: 'CSA S16-19 23.8',
      standard: 'ASTM F3125',
      csiDivision: '01',
      frequency: 'Per connection group',
      estimatedQuantity: Math.max(Math.ceil(steelWeight / 2000), 3),
      unitCost: 125,
      totalCost: Math.max(Math.ceil(steelWeight / 2000), 3) * 125,
      notes: 'One test per connection group, minimum 3',
    });
  }

  // Air barrier testing — ASTM E2357 (for buildings > 3 storeys or NECB)
  if (config.numberOfStoreys >= 3 || config.energyCode === 'NECB_2020') {
    items.push({
      id: 'QA-AIR-BARRIER',
      description: 'Air barrier continuity testing — blower door or tracer gas',
      code: 'NECB 2020 3.3.1 / NBC 5.4',
      standard: 'ASTM E2357 / ASTM E3158',
      csiDivision: '01',
      frequency: '1 test per building or wing',
      estimatedQuantity: 1,
      unitCost: 8500,
      totalCost: 8500,
      notes: 'Whole-building air leakage test per NECB requirement',
    });
  }

  // Roofing water test
  const roofItems = estimate.floors.flatMap(f => f.lineItems.filter(li =>
    li.csiDivision === '07' && li.description.toLowerCase().includes('roof')));
  if (roofItems.length > 0) {
    items.push({
      id: 'QA-ROOF-WATER',
      description: 'Roof membrane water test (flood test or spray test)',
      code: 'OBC SB-13 / NRCA',
      standard: 'ASTM D5957',
      csiDivision: '01',
      frequency: '1 per roof section',
      estimatedQuantity: Math.max(1, Math.ceil(config.grossFloorArea / config.numberOfStoreys / 500)),
      unitCost: 1200,
      totalCost: Math.max(1, Math.ceil(config.grossFloorArea / config.numberOfStoreys / 500)) * 1200,
      notes: 'Roof section water testing prior to insulation',
    });
  }

  // Fireproofing thickness verification
  if (config.fireRating !== '0hr' && config.constructionType === 'non_combustible') {
    items.push({
      id: 'QA-FIREPROOF',
      description: 'Spray-applied fireproofing thickness verification',
      code: 'OBC 3.2.2 / CAN/ULC S101',
      standard: 'ASTM E605',
      csiDivision: '01',
      frequency: '1 per 1000 m² of fireproofed area',
      estimatedQuantity: Math.max(1, Math.ceil(config.grossFloorArea / 1000)),
      unitCost: 450,
      totalCost: Math.max(1, Math.ceil(config.grossFloorArea / 1000)) * 450,
      notes: 'Thickness gauge readings per ASTM E605',
    });
  }

  return items;
}


// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────

/** Apply all code-driven adders and generate QA testing requirements */
export function applyCodeAdders(
  config: CodeAdderConfig,
  estimate: EstimateSummary,
): CodeAdderResult {
  // Build division cost map from estimate
  const directCostByDiv = new Map<string, number>();
  for (const floor of estimate.floors) {
    for (const li of floor.lineItems) {
      directCostByDiv.set(li.csiDivision, (directCostByDiv.get(li.csiDivision) ?? 0) + li.totalCost);
    }
  }

  // Collect all adders
  const adders: CodeAdder[] = [
    ...getFireRatingAdders(config, directCostByDiv),
    ...getSeismicAdders(config, directCostByDiv),
    ...getEnergyAdders(config, directCostByDiv),
    ...getAccessibilityAdders(config, directCostByDiv),
  ];

  const qaTestingItems = generateQATestingItems(config, estimate);

  const totalAdderCost = adders.reduce((s, a) => s + a.appliedAmount, 0);
  const totalQATestingCost = qaTestingItems.reduce((s, q) => s + q.totalCost, 0);

  return {
    projectId: config.projectId,
    config,
    adders,
    qaTestingItems,
    totalAdderCost: Math.round(totalAdderCost * 100) / 100,
    totalQATestingCost: Math.round(totalQATestingCost * 100) / 100,
    grandTotal: Math.round((totalAdderCost + totalQATestingCost) * 100) / 100,
    adderPercentOfDirect: estimate.grandTotal > 0
      ? Math.round(((totalAdderCost + totalQATestingCost) / estimate.grandTotal) * 10000) / 100
      : 0,
    generatedAt: new Date().toISOString(),
  };
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const configStore = new Map<string, CodeAdderConfig>();
const resultStore = new Map<string, CodeAdderResult>();

export function storeConfig(config: CodeAdderConfig): CodeAdderConfig {
  configStore.set(config.projectId, config);
  return config;
}
export function getConfig(projectId: string): CodeAdderConfig | undefined {
  return configStore.get(projectId);
}
export function getResult(projectId: string): CodeAdderResult | undefined {
  return resultStore.get(projectId);
}
export function storeResult(result: CodeAdderResult): CodeAdderResult {
  resultStore.set(result.projectId, result);
  return result;
}
export function deleteConfig(projectId: string): boolean {
  resultStore.delete(projectId);
  return configStore.delete(projectId);
}
