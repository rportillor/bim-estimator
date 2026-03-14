// server/estimator/codes-standards-register.ts
// =============================================================================
// CODES & STANDARDS REGISTER
// =============================================================================
//
// Implements QS Level 5 Phases 1 & 2:
//   Phase 1 — Codes & Standards Register (document what governs the project)
//   Phase 2 — Code-Driven Cost Adders (translate requirements into costs)
//
// Purpose:
//   1. Register all applicable codes, standards, and specifications
//   2. Map code requirements to affected CSI divisions and cost impacts
//   3. Generate code-driven cost adders (fire rating, seismic, energy, AODA)
//   4. Auto-generate QA/QC testing line items from code requirements
//   5. Pre-populated Canadian project templates (NBC/OBC, CSA, NECB, AODA)
//
// Standards: NBC 2020, OBC 2024, CSA, ASHRAE 90.1, NECB 2017, AODA
// =============================================================================

import type { EstimateSummary } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CodesStandardsEntry {
  id: string;
  code: string;              // e.g., "OBC 2024", "CSA A23.3"
  edition: string;           // e.g., "2024", "2019 (R2023)"
  category: CodeCategory;
  description: string;       // What the standard requires
  requirement: string;       // Specific clause or section
  affectedCSI: string[];     // CSI divisions affected (e.g., ['03','05'])
  costImpactType: 'multiplier' | 'flatCost' | 'testing' | 'informational';
  costMultiplier?: number;   // e.g., 1.20 = 20% adder
  flatCost?: number;         // Fixed cost amount
  testingFrequency?: string; // e.g., "1 per 75 m³ concrete"
  applicability: 'all' | 'conditional';
  condition?: string;        // When applicability is 'conditional'
  notes?: string;
}

export type CodeCategory =
  | 'building-code'
  | 'structural'
  | 'fire-life-safety'
  | 'energy'
  | 'mechanical'
  | 'electrical'
  | 'plumbing'
  | 'accessibility'
  | 'environmental'
  | 'material-standard';

export interface CodeAdder {
  codeEntryId: string;       // Links to CodesStandardsEntry.id
  code: string;              // Human-readable code reference
  requirement: string;       // What requirement drives the adder
  affectedCSI: string[];     // Which divisions get the cost impact
  type: 'multiplier' | 'flatCost';
  multiplier?: number;       // Applied to affected division subtotals
  flatCost?: number;         // Added as line item
  description: string;       // Description for cost report
}

export interface TestingRequirement {
  codeEntryId: string;       // Links to CodesStandardsEntry.id
  code: string;
  testType: string;          // e.g., "Concrete cylinder testing"
  standard: string;          // e.g., "CSA A23.1 Clause 17"
  frequency: string;         // e.g., "1 set per 75 m³ or fraction thereof"
  unitCost: number;          // Cost per test (CAD)
  estimatedQuantity?: number; // Auto-calculated from estimate where possible
  estimatedCost?: number;
  affectedCSI: string[];
  notes?: string;
}

export interface CodeComplianceSummary {
  projectName: string;
  jurisdiction: string;
  buildingCodeEdition: string;
  totalEntries: number;
  categoryCounts: Record<CodeCategory, number>;
  adders: CodeAdder[];
  totalAdderAmount: number;
  lineItemDistribution: CodeAdderLineItem[];  // Full code-to-assembly wiring
  testingRequirements: TestingRequirement[];
  totalTestingCost: number;
  complianceNotes: string[];
  generatedAt: string;
}

export interface RegisterConfig {
  province: 'ON' | 'BC' | 'AB' | 'QC' | 'MB' | 'SK' | 'NS' | 'NB' | 'NL' | 'PE' | 'NT' | 'NU' | 'YT';
  buildingType: string;                    // Any BuildingProjectType from benchmark-pack-building
  projectCategory?: 'building' | 'civil' | 'pipeline' | 'infrastructure' | 'mining';
  constructionType: 'combustible' | 'non-combustible' | 'heavy-timber';
  occupancyGroup?: string;        // OBC Group A/B/C/D/E/F
  numberOfStoreys?: number;
  buildingArea?: number;          // m² GFA
  sprinklered?: boolean;
  seismicCategory?: string;       // e.g., "0.2", "0.35"
  energyCode?: 'NECB2017' | 'SB-10' | 'SB-12';
  customEntries?: CodesStandardsEntry[];
}

// ─── Canadian Codes & Standards Templates ────────────────────────────────────
// Pre-populated for Ontario. Province-specific overrides applied at generation.

function getOntarioBaseRegister(): CodesStandardsEntry[] {
  return [
    // ── BUILDING CODE ──
    {
      id: 'OBC-001', code: 'OBC 2024', edition: '2024 (O. Reg. 332/12, as amended)',
      category: 'building-code', description: 'Ontario Building Code — primary governing code',
      requirement: 'All Parts', affectedCSI: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14'],
      costImpactType: 'informational', applicability: 'all',
    },
    {
      id: 'NBC-001', code: 'NBC 2020', edition: '2020 (referenced by OBC)',
      category: 'building-code', description: 'National Building Code of Canada — referenced standards',
      requirement: 'Division B', affectedCSI: ['03','04','05','06','07','08'],
      costImpactType: 'informational', applicability: 'all',
    },

    // ── STRUCTURAL ──
    {
      id: 'CSA-A23.3', code: 'CSA A23.3', edition: '2019 (R2023)',
      category: 'structural', description: 'Design of concrete structures',
      requirement: 'Clauses 10-23', affectedCSI: ['03'],
      costImpactType: 'informational', applicability: 'all',
      notes: 'Governs rebar development lengths, cover requirements, and minimum reinforcement ratios',
    },
    {
      id: 'CSA-A23.1', code: 'CSA A23.1', edition: '2019',
      category: 'structural', description: 'Concrete materials and methods of construction',
      requirement: 'Clause 17 — Testing', affectedCSI: ['03'],
      costImpactType: 'testing', testingFrequency: '1 set per 75 m³ or fraction thereof',
      applicability: 'all',
    },
    {
      id: 'CSA-S16', code: 'CSA S16', edition: '2019 (R2023)',
      category: 'structural', description: 'Design of steel structures',
      requirement: 'Clauses 13-27', affectedCSI: ['05'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Structural steel framing',
    },
    {
      id: 'CSA-O86', code: 'CSA O86', edition: '2019',
      category: 'structural', description: 'Engineering design in wood',
      requirement: 'All clauses', affectedCSI: ['06'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Wood-frame or heavy timber construction',
    },
    {
      id: 'CSA-S304', code: 'CSA S304', edition: '2014 (R2019)',
      category: 'structural', description: 'Design of masonry structures',
      requirement: 'All clauses', affectedCSI: ['04'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Load-bearing or reinforced masonry',
    },

    // ── FIRE & LIFE SAFETY ──
    {
      id: 'OBC-FLS-1', code: 'OBC 2024 Part 3', edition: '2024',
      category: 'fire-life-safety', description: 'Fire protection, occupant safety, and accessibility',
      requirement: 'Section 3.2 — Fire separations and ratings',
      affectedCSI: ['07','09'],
      costImpactType: 'multiplier', costMultiplier: 1.20,
      applicability: 'all',
      notes: 'Fire-rated assemblies add ~20% to Div 07/09 for gypsum layers, fire-stop, and fire dampers',
    },
    {
      id: 'OBC-FLS-2', code: 'OBC 2024 Part 3', edition: '2024',
      category: 'fire-life-safety', description: 'Sprinkler requirements',
      requirement: 'Section 3.2.5', affectedCSI: ['21'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Buildings requiring sprinklers per OBC 3.2.5',
    },
    {
      id: 'CAN-ULC-S101', code: 'CAN/ULC-S101', edition: '2019',
      category: 'fire-life-safety', description: 'Standard methods of fire endurance tests',
      requirement: 'Referenced for fire-rated assemblies',
      affectedCSI: ['07','09'],
      costImpactType: 'testing', testingFrequency: 'Per assembly certification — no field testing',
      applicability: 'all',
    },
    {
      id: 'NFPA-13', code: 'NFPA 13', edition: '2022',
      category: 'fire-life-safety', description: 'Standard for the Installation of Sprinkler Systems',
      requirement: 'Chapters 8-19 — design and installation',
      affectedCSI: ['21'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Sprinklered buildings',
    },

    // ── ENERGY CODE ──
    {
      id: 'NECB-001', code: 'NECB 2017', edition: '2017 (referenced by OBC SB-10)',
      category: 'energy', description: 'National Energy Code of Canada for Buildings',
      requirement: 'Div 3 — Building envelope thermal performance',
      affectedCSI: ['07','08'],
      costImpactType: 'multiplier', costMultiplier: 1.12,
      applicability: 'all',
      notes: 'Energy code compliance typically adds 10-15% to Div 07 insulation and Div 08 glazing',
    },
    {
      id: 'OBC-SB10', code: 'OBC SB-10', edition: '2024',
      category: 'energy', description: 'Ontario Supplementary Standard SB-10 — Energy Efficiency',
      requirement: 'All sections', affectedCSI: ['07','08','23'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Part 3 buildings (> 600 m² or > 3 storeys)',
    },
    {
      id: 'OBC-SB12', code: 'OBC SB-12', edition: '2024',
      category: 'energy', description: 'Ontario Supplementary Standard SB-12 — Energy Efficiency for Housing',
      requirement: 'All sections', affectedCSI: ['07','08','23'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Part 9 housing',
    },
    {
      id: 'ASHRAE-90.1', code: 'ASHRAE 90.1', edition: '2019',
      category: 'energy', description: 'Energy standard for buildings (performance path reference)',
      requirement: 'Sections 5-10', affectedCSI: ['07','08','23','26'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'When using performance compliance path',
    },
    {
      id: 'AIR-BARRIER', code: 'ASTM E2357', edition: '2018',
      category: 'energy', description: 'Air leakage testing of building envelope assemblies',
      requirement: 'Field testing', affectedCSI: ['07'],
      costImpactType: 'testing', testingFrequency: '1 test per building or per major air barrier system',
      applicability: 'all',
      notes: 'Required for OBC SB-10 compliance; minimum 3 test locations',
    },

    // ── MECHANICAL ──
    {
      id: 'CSA-B149.1', code: 'CSA B149.1', edition: '2020',
      category: 'mechanical', description: 'Natural gas and propane installation code',
      requirement: 'All clauses', affectedCSI: ['23'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Gas-fired equipment or gas distribution',
    },
    {
      id: 'CSA-B52', code: 'CSA B52', edition: '2018',
      category: 'mechanical', description: 'Mechanical refrigeration code',
      requirement: 'All clauses', affectedCSI: ['23'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Refrigeration systems',
    },
    {
      id: 'ASHRAE-CX', code: 'ASHRAE Guideline 0', edition: '2019',
      category: 'mechanical', description: 'Commissioning process',
      requirement: 'Full building commissioning', affectedCSI: ['23','25','26'],
      costImpactType: 'testing', testingFrequency: '1 per building — comprehensive',
      applicability: 'conditional',
      condition: 'Buildings > 1,000 m² or requiring LEED/green certification',
    },

    // ── PLUMBING ──
    {
      id: 'OBC-PLUMB', code: 'OBC 2024 Part 7', edition: '2024',
      category: 'plumbing', description: 'Plumbing systems',
      requirement: 'All sections', affectedCSI: ['22'],
      costImpactType: 'informational', applicability: 'all',
    },
    {
      id: 'CSA-B64', code: 'CSA B64', edition: '2018',
      category: 'plumbing', description: 'Backflow preventers and cross-connection control',
      requirement: 'All clauses', affectedCSI: ['22'],
      costImpactType: 'informational', applicability: 'all',
    },

    // ── ELECTRICAL ──
    {
      id: 'CSA-C22.1', code: 'CSA C22.1 (CEC)', edition: '2021',
      category: 'electrical', description: 'Canadian Electrical Code',
      requirement: 'All sections', affectedCSI: ['26'],
      costImpactType: 'informational', applicability: 'all',
    },
    {
      id: 'CSA-C22.2', code: 'CSA C22.2 No. 0', edition: '2019',
      category: 'electrical', description: 'Product safety standards',
      requirement: 'All products', affectedCSI: ['26','27','28'],
      costImpactType: 'informational', applicability: 'all',
    },

    // ── ACCESSIBILITY ──
    {
      id: 'AODA-001', code: 'AODA / OBC Part 3', edition: '2024',
      category: 'accessibility', description: 'Accessibility for Ontarians with Disabilities Act',
      requirement: 'Barrier-free design requirements', affectedCSI: ['14','10','32'],
      costImpactType: 'multiplier', costMultiplier: 1.05,
      applicability: 'all',
      notes: 'Accessibility adds ~3-5% for elevators, signage, ramps, door operators, and wayfinding',
    },
    {
      id: 'CSA-B651', code: 'CSA B651', edition: '2018',
      category: 'accessibility', description: 'Accessible design for the built environment',
      requirement: 'All clauses', affectedCSI: ['10','14','22','32'],
      costImpactType: 'informational', applicability: 'all',
    },

    // ── ENVIRONMENTAL ──
    {
      id: 'O-REG-153', code: 'O. Reg. 153/04', edition: 'As amended',
      category: 'environmental', description: 'Record of Site Condition — Environmental Protection Act',
      requirement: 'Phase I/II ESA when required', affectedCSI: ['02','31'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Change of use to more sensitive use',
    },
    {
      id: 'O-REG-278', code: 'O. Reg. 278/05', edition: 'As amended',
      category: 'environmental', description: 'Designated substances — Asbestos',
      requirement: 'Testing and abatement prior to demolition', affectedCSI: ['02'],
      costImpactType: 'informational', applicability: 'conditional',
      condition: 'Buildings constructed before 1985',
    },

    // ── MATERIAL STANDARDS (key ASTM/CSA specs) ──
    {
      id: 'CSA-A23.2', code: 'CSA A23.2', edition: '2019',
      category: 'material-standard', description: 'Methods of test and standard practices for concrete',
      requirement: 'Standard test methods', affectedCSI: ['03'],
      costImpactType: 'testing', testingFrequency: '1 set cylinders per 75 m³; slump per load',
      applicability: 'all',
    },
    {
      id: 'CSA-G40.20', code: 'CSA G40.20/G40.21', edition: '2019',
      category: 'material-standard', description: 'General requirements for rolled or welded structural quality steel',
      requirement: 'Mill certificates and inspection', affectedCSI: ['05'],
      costImpactType: 'testing', testingFrequency: 'Mill certs per heat; field inspection per connection type',
      applicability: 'conditional', condition: 'Structural steel framing',
    },
    {
      id: 'CSA-W59', code: 'CSA W59', edition: '2018',
      category: 'material-standard', description: 'Welded steel construction',
      requirement: 'Welding inspection', affectedCSI: ['05'],
      costImpactType: 'testing', testingFrequency: 'Per welding procedure; UT/RT on critical connections',
      applicability: 'conditional', condition: 'Structural steel with field welding',
    },
  ];
}

// ─── Code Adder Generation ───────────────────────────────────────────────────

/**
 * Generate cost adders from the register.
 * Adders are applied AFTER base QTO, tracked separately for transparency.
 */
function generateCodeAdders(register: CodesStandardsEntry[]): CodeAdder[] {
  const adders: CodeAdder[] = [];

  for (const entry of register) {
    if (entry.costImpactType === 'multiplier' && entry.costMultiplier) {
      adders.push({
        codeEntryId: entry.id,
        code: entry.code,
        requirement: entry.requirement,
        affectedCSI: entry.affectedCSI,
        type: 'multiplier',
        multiplier: entry.costMultiplier,
        description: entry.description + ' — ' + ((entry.costMultiplier - 1) * 100).toFixed(0) + '% adder',
      });
    } else if (entry.costImpactType === 'flatCost' && entry.flatCost) {
      adders.push({
        codeEntryId: entry.id,
        code: entry.code,
        requirement: entry.requirement,
        affectedCSI: entry.affectedCSI,
        type: 'flatCost',
        flatCost: entry.flatCost,
        description: entry.description,
      });
    }
  }

  return adders;
}

/**
 * Calculate the total cost impact of code adders on an estimate.
 */
export function applyCodeAdders(
  estimate: EstimateSummary,
  adders: CodeAdder[]
): { adder: CodeAdder; baseAmount: number; adderAmount: number }[] {
  const results: { adder: CodeAdder; baseAmount: number; adderAmount: number }[] = [];

  for (const adder of adders) {
    // Sum the affected division costs
    let baseAmount = 0;
    for (const floor of estimate.floors) {
      for (const item of floor.lineItems) {
        if (adder.affectedCSI.includes(item.csiDivision)) {
          baseAmount += item.totalCost;
        }
      }
    }

    let adderAmount = 0;
    if (adder.type === 'multiplier' && adder.multiplier) {
      adderAmount = baseAmount * (adder.multiplier - 1);
    } else if (adder.type === 'flatCost' && adder.flatCost) {
      adderAmount = adder.flatCost;
    }

    results.push({ adder, baseAmount, adderAmount });
  }

  return results;
}

// ─── Code-to-Assembly Wiring (Line-Item Distribution) ────────────────────────

/**
 * Represents a code adder distributed to a specific line item.
 * This is the "wiring" that connects code requirements to individual
 * assemblies in the estimate, giving full traceability.
 */
export interface CodeAdderLineItem {
  codeEntryId: string;          // Which code drives this adder
  codeName: string;             // Human-readable code reference
  floorLabel: string;           // Which floor the line item is on
  lineItemDescription: string;  // Original line item description
  csiDivision: string;          // CSI division of the line item
  csiSubdivision: string;       // CSI subdivision of the line item
  baseItemCost: number;         // Original cost of the line item
  proportionOfDivision: number; // This item's share of division total (0-1)
  adderAmount: number;          // This item's share of the adder
  adderType: 'multiplier' | 'flatCost';
  multiplierApplied?: number;   // e.g., 1.20
}

/**
 * Distribute code adders proportionally to individual line items.
 *
 * For multiplier adders: each line item in an affected division gets
 * its proportional share based on (item cost / division total).
 * A $100K line item in a $500K division gets 20% of the adder.
 *
 * For flat-cost adders: distributed equally across affected line items
 * (these are typically lump-sum code requirements).
 *
 * This completes the code-to-assembly wiring — every dollar of every
 * code adder is traced to a specific assembly line item.
 */
export function distributeAddersToLineItems(
  estimate: EstimateSummary,
  adderResults: { adder: CodeAdder; baseAmount: number; adderAmount: number }[]
): CodeAdderLineItem[] {
  const distributed: CodeAdderLineItem[] = [];

  for (const result of adderResults) {
    if (result.adderAmount <= 0) continue;

    const { adder, baseAmount, adderAmount } = result;

    if (adder.type === 'multiplier') {
      // Proportional distribution: each item gets (itemCost/divisionTotal) * adderAmount
      for (const floor of estimate.floors) {
        for (const item of floor.lineItems) {
          if (!adder.affectedCSI.includes(item.csiDivision)) continue;
          if (item.totalCost <= 0) continue;

          const proportion = baseAmount > 0 ? item.totalCost / baseAmount : 0;
          const itemAdder = adderAmount * proportion;

          distributed.push({
            codeEntryId: adder.codeEntryId,
            codeName: adder.code,
            floorLabel: floor.floorLabel,
            lineItemDescription: item.description,
            csiDivision: item.csiDivision,
            csiSubdivision: item.csiSubdivision,
            baseItemCost: item.totalCost,
            proportionOfDivision: proportion,
            adderAmount: Math.round(itemAdder * 100) / 100,
            adderType: 'multiplier',
            multiplierApplied: adder.multiplier,
          });
        }
      }
    } else if (adder.type === 'flatCost') {
      // Equal distribution across affected line items
      let affectedCount = 0;
      for (const floor of estimate.floors) {
        for (const item of floor.lineItems) {
          if (adder.affectedCSI.includes(item.csiDivision) && item.totalCost > 0) {
            affectedCount++;
          }
        }
      }
      if (affectedCount === 0) continue;

      const perItem = adderAmount / affectedCount;
      for (const floor of estimate.floors) {
        for (const item of floor.lineItems) {
          if (!adder.affectedCSI.includes(item.csiDivision)) continue;
          if (item.totalCost <= 0) continue;

          distributed.push({
            codeEntryId: adder.codeEntryId,
            codeName: adder.code,
            floorLabel: floor.floorLabel,
            lineItemDescription: item.description,
            csiDivision: item.csiDivision,
            csiSubdivision: item.csiSubdivision,
            baseItemCost: item.totalCost,
            proportionOfDivision: 1 / affectedCount,
            adderAmount: Math.round(perItem * 100) / 100,
            adderType: 'flatCost',
          });
        }
      }
    }
  }

  return distributed;
}

// ─── Testing Requirements Generation ─────────────────────────────────────────

/**
 * Generate QA/QC testing line items from code requirements and estimate quantities.
 * Auto-calculates quantities where possible (e.g., concrete volume → number of test sets).
 */
function generateTestingRequirements(
  register: CodesStandardsEntry[],
  estimate: EstimateSummary
): TestingRequirement[] {
  const reqs: TestingRequirement[] = [];

  // Calculate total concrete volume from estimate
  let concreteVolume = 0;
  let steelTonnage = 0;
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      if (item.csiDivision === '03' && item.unit === 'm³') {
        concreteVolume += item.baseQuantity;
      }
      if (item.csiDivision === '05' && (item.unit === 'tonne' || item.unit === 'kg')) {
        steelTonnage += item.unit === 'kg' ? item.baseQuantity / 1000 : item.baseQuantity;
      }
    }
  }

  for (const entry of register) {
    if (entry.costImpactType !== 'testing') continue;

    const req: TestingRequirement = {
      codeEntryId: entry.id,
      code: entry.code,
      testType: entry.description,
      standard: entry.code + ' ' + entry.requirement,
      frequency: entry.testingFrequency || 'As required',
      unitCost: 0,
      affectedCSI: entry.affectedCSI,
      notes: entry.notes,
    };

    // Auto-calculate quantities and costs
    if (entry.id === 'CSA-A23.1' || entry.id === 'CSA-A23.2') {
      // Concrete testing: 1 set per 75 m³
      req.testType = 'Concrete cylinder testing (1 set = 4 cylinders)';
      req.unitCost = 185;  // CAD per set (standard Ontario rate)
      if (concreteVolume > 0) {
        req.estimatedQuantity = Math.ceil(concreteVolume / 75);
        req.estimatedCost = req.estimatedQuantity * req.unitCost;
      }
    } else if (entry.id === 'CSA-G40.20') {
      // Steel mill certs and field inspection
      req.testType = 'Structural steel inspection (mill certs + field)';
      req.unitCost = 850;  // CAD per inspection day
      if (steelTonnage > 0) {
        req.estimatedQuantity = Math.max(2, Math.ceil(steelTonnage / 50));
        req.estimatedCost = req.estimatedQuantity * req.unitCost;
      }
    } else if (entry.id === 'CSA-W59') {
      // Weld inspection
      req.testType = 'Welding inspection (visual + UT/RT)';
      req.unitCost = 650;  // CAD per inspection day
      if (steelTonnage > 0) {
        req.estimatedQuantity = Math.max(1, Math.ceil(steelTonnage / 100));
        req.estimatedCost = req.estimatedQuantity * req.unitCost;
      }
    } else if (entry.id === 'AIR-BARRIER') {
      // Air barrier testing
      req.testType = 'Air barrier field testing (ASTM E2357)';
      req.unitCost = 3500;  // CAD per test location
      req.estimatedQuantity = 3;  // Minimum 3 locations per OBC SB-10
      req.estimatedCost = req.estimatedQuantity * req.unitCost;
    } else if (entry.id === 'ASHRAE-CX') {
      // Commissioning
      req.testType = 'Building commissioning (ASHRAE Guideline 0)';
      req.unitCost = 15000;  // CAD lump sum estimate for typical building
      req.estimatedQuantity = 1;
      req.estimatedCost = req.unitCost;
    } else if (entry.id === 'CAN-ULC-S101') {
      // Fire test — typically no field cost, it's certification
      req.testType = 'Fire endurance certification verification';
      req.unitCost = 0;
      req.estimatedQuantity = 0;
      req.estimatedCost = 0;
      req.notes = 'Assembly certifications verified by designer — no field testing cost';
    }

    reqs.push(req);
  }

  return reqs;
}

// ─── Main Register Builder ───────────────────────────────────────────────────

/**
 * Build the complete Codes & Standards Register for a project.
 * Returns the register entries, cost adders, testing requirements,
 * and a formatted compliance summary.
 */
export function buildCodesStandardsRegister(
  config: RegisterConfig,
  estimate: EstimateSummary
): CodeComplianceSummary {
  // Start with Ontario base register
  let register = getOntarioBaseRegister();

  // Add seismic adder if high seismic zone
  if (config.seismicCategory) {
    const seismicFactor = parseFloat(config.seismicCategory);
    if (seismicFactor >= 0.35) {
      register.push({
        id: 'SEISMIC-HIGH', code: 'NBC 2020 Div B Part 4', edition: '2020',
        category: 'structural', description: 'High seismic zone structural requirements',
        requirement: 'Section 4.1.8 — Seismic design', affectedCSI: ['03', '05'],
        costImpactType: 'multiplier', costMultiplier: 1.12,
        applicability: 'all',
        notes: 'Sa(0.2) >= 0.35g — adds ~10-15% to structural divisions for ductile detailing',
      });
    } else if (seismicFactor >= 0.20) {
      register.push({
        id: 'SEISMIC-MOD', code: 'NBC 2020 Div B Part 4', edition: '2020',
        category: 'structural', description: 'Moderate seismic zone structural requirements',
        requirement: 'Section 4.1.8 — Seismic design', affectedCSI: ['03', '05'],
        costImpactType: 'multiplier', costMultiplier: 1.06,
        applicability: 'all',
        notes: 'Sa(0.2) 0.20-0.35g — adds ~5-8% to structural for seismic detailing',
      });
    }
  }

  // Add combustible construction adders
  if (config.constructionType === 'combustible' && config.numberOfStoreys && config.numberOfStoreys > 3) {
    register.push({
      id: 'COMBUSTIBLE-TALL', code: 'OBC 2024 Part 3', edition: '2024',
      category: 'fire-life-safety',
      description: 'Combustible construction > 3 storeys — enhanced fire protection',
      requirement: 'Section 3.2.2 — Encapsulated mass timber',
      affectedCSI: ['06', '07', '09'],
      costImpactType: 'multiplier', costMultiplier: 1.15,
      applicability: 'all',
      notes: 'Mass timber encapsulation adds ~15% to structure and finishes',
    });
  }

  // Append custom entries
  if (config.customEntries) {
    register = register.concat(config.customEntries);
  }

  // Generate code adders
  const adders = generateCodeAdders(register);
  const adderResults = applyCodeAdders(estimate, adders);
  const totalAdderAmount = adderResults.reduce((s, r) => s + r.adderAmount, 0);

  // Distribute adders to individual line items (code-to-assembly wiring)
  const lineItemDistribution = distributeAddersToLineItems(estimate, adderResults);

  // Generate testing requirements
  const testingReqs = generateTestingRequirements(register, estimate);
  const totalTestingCost = testingReqs.reduce((s, r) => s + (r.estimatedCost || 0), 0);

  // Category counts
  const categoryCounts = {} as Record<CodeCategory, number>;
  for (const entry of register) {
    categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
  }

  // Compliance notes
  const complianceNotes: string[] = [];
  complianceNotes.push('Register pre-populated for Ontario jurisdiction, OBC 2024 edition.');
  complianceNotes.push('Code adders applied after base QTO for transparency. Total adder: $' +
    totalAdderAmount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  complianceNotes.push('Testing requirements auto-calculated from estimate quantities where possible.');
  if (config.seismicCategory) {
    complianceNotes.push('Seismic design: Sa(0.2) = ' + config.seismicCategory + 'g');
  }
  if (config.sprinklered) {
    complianceNotes.push('Building is sprinklered — NFPA 13 / OBC 3.2.5 applicable.');
  }

  return {
    projectName: '',  // Set by caller
    jurisdiction: config.province === 'ON' ? 'Ontario, Canada' : config.province + ', Canada',
    buildingCodeEdition: 'OBC 2024 / NBC 2020',
    totalEntries: register.length,
    categoryCounts,
    adders,
    totalAdderAmount,
    lineItemDistribution,
    testingRequirements: testingReqs,
    totalTestingCost,
    complianceNotes,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format the register as a human-readable report.
 */
export function formatCodesRegisterReport(
  summary: CodeComplianceSummary,
  register: CodesStandardsEntry[]
): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  CODES & STANDARDS REGISTER');
  out.push('  ' + summary.jurisdiction + ' | ' + summary.buildingCodeEdition);
  out.push('====================================================================');
  out.push('');
  out.push('  Total entries: ' + summary.totalEntries);
  out.push('  Code-driven adders: ' + summary.adders.length + ' (' + f(summary.totalAdderAmount) + ')');
  out.push('  Testing requirements: ' + summary.testingRequirements.length + ' (' + f(summary.totalTestingCost) + ')');
  out.push('');

  // Group by category
  const byCategory = new Map<CodeCategory, CodesStandardsEntry[]>();
  for (const entry of register) {
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
    byCategory.get(entry.category)!.push(entry);
  }

  const categoryNames: Record<CodeCategory, string> = {
    'building-code': 'Building Code',
    'structural': 'Structural',
    'fire-life-safety': 'Fire & Life Safety',
    'energy': 'Energy',
    'mechanical': 'Mechanical',
    'electrical': 'Electrical',
    'plumbing': 'Plumbing',
    'accessibility': 'Accessibility',
    'environmental': 'Environmental',
    'material-standard': 'Material Standards',
  };

  for (const [cat, entries] of byCategory) {
    out.push('  ── ' + categoryNames[cat] + ' (' + entries.length + ') ──');
    for (const e of entries) {
      const impact = e.costImpactType === 'multiplier' ? ' [+' + ((e.costMultiplier! - 1) * 100).toFixed(0) + '%]' :
                     e.costImpactType === 'testing' ? ' [TESTING]' :
                     e.costImpactType === 'flatCost' ? ' [' + f(e.flatCost!) + ']' : '';
      out.push('    [' + e.id + '] ' + e.code + impact);
      out.push('      ' + e.description);
      out.push('      Affects: Div ' + e.affectedCSI.join(', '));
    }
    out.push('');
  }

  // Testing summary
  if (summary.testingRequirements.length > 0) {
    out.push('  ── Testing Requirements ──');
    for (const t of summary.testingRequirements) {
      const cost = t.estimatedCost ? ' → ' + f(t.estimatedCost) : '';
      const qty = t.estimatedQuantity ? ' (' + t.estimatedQuantity + ' tests)' : '';
      out.push('    ' + t.testType + qty + cost);
      out.push('      Standard: ' + t.standard);
      out.push('      Frequency: ' + t.frequency);
    }
    out.push('');
  }

  // Line-item distribution summary (code-to-assembly wiring)
  if (summary.lineItemDistribution.length > 0) {
    out.push('  ── Code-to-Assembly Distribution (' + summary.lineItemDistribution.length + ' items) ──');
    // Group by code entry for readability
    const byCode = new Map<string, CodeAdderLineItem[]>();
    for (const item of summary.lineItemDistribution) {
      if (!byCode.has(item.codeEntryId)) byCode.set(item.codeEntryId, []);
      byCode.get(item.codeEntryId)!.push(item);
    }
    for (const [_codeId, items] of byCode) {
      const totalForCode = items.reduce((s, i) => s + i.adderAmount, 0);
      out.push('    ' + items[0].codeName + ' → ' + f(totalForCode) + ' across ' + items.length + ' line items');
      // Show top 5 by adder amount
      const top5 = items.sort((a, b) => b.adderAmount - a.adderAmount).slice(0, 5);
      for (const li of top5) {
        out.push('      ' + li.floorLabel + ' | Div ' + li.csiDivision + '.' + li.csiSubdivision +
          ' | ' + li.lineItemDescription.substring(0, 40) +
          ' | base: ' + f(li.baseItemCost) + ' → +' + f(li.adderAmount) +
          ' (' + (li.proportionOfDivision * 100).toFixed(1) + '%)');
      }
      if (items.length > 5) out.push('      ... and ' + (items.length - 5) + ' more items');
    }
    out.push('');
  }

  out.push('====================================================================');
  return out.join('\n');
}

// ─── CODE-7: Auto Pre-Screen Applicable Code Adders ──────────────────────────
// After BIM model is generated, screen which code adders likely apply based on
// occupancy group, number of storeys, construction type, and sprinkler status.
// Returns a list for QS confirmation before they are actually applied.
// ─────────────────────────────────────────────────────────────────────────────

export interface PrescreenResult {
  applicableAdders: (CodeAdder & { reason: string; requiresQsConfirmation: boolean })[];
  config: Partial<RegisterConfig>;
  screenedAt: string;
  notes: string[];
}

/**
 * Infer likely applicable code adders from BIM model metadata without
 * requiring the QS to manually scroll through every OBC rule.
 * Output is a CONFIRMATION LIST, not an automatic application —
 * the QS must approve each adder before it is applied to the estimate.
 */
export function prescreenCodeAdders(
  modelMetadata: {
    occupancyGroup?: string;        // OBC group: A1/A2/B1/B2/C/D/E/F1/F2/F3
    numberOfStoreys?: number;
    gfa?: number;                   // m² gross floor area
    constructionType?: 'combustible' | 'non-combustible' | 'heavy-timber';
    sprinklered?: boolean;
    seismicPga?: number;            // Peak Ground Acceleration (g) from NBC Table C-2
    province?: string;
    hasElevator?: boolean;
    hasParkadeLevel?: boolean;
  }
): PrescreenResult {
  const notes: string[] = [];
  const applicable: PrescreenResult['applicableAdders'] = [];

  const occ = (modelMetadata.occupancyGroup || '').toUpperCase();
  const storeys = modelMetadata.numberOfStoreys ?? 0;
  const gfa = modelMetadata.gfa ?? 0;
  const isCombustible = modelMetadata.constructionType === 'combustible';
  const pga = modelMetadata.seismicPga ?? 0;

  // ── Part 3 applicability (>600 m² or >3 storeys) ────────────────────────
  const isPart3 = gfa > 600 || storeys > 3;
  if (isPart3) {
    applicable.push({
      codeEntryId: 'OBC-PART3-BARRIER-FREE', code: 'OBC 2024 Part 3 / s.3.8', requirement: 'Barrier-free design',
      affectedCSI: ['08', '10', '14'], type: 'multiplier', multiplier: 1.015,
      description: 'Barrier-free design: accessible door hardware, tactile indicators, accessible washrooms (OBC s.3.8)',
      reason: `Building is Part 3 (GFA=${gfa.toFixed(0)} m², ${storeys} storeys)`,
      requiresQsConfirmation: true,
    });
    notes.push('Part 3 building confirmed — barrier-free and full OBC Part 3 adders apply.');
  }

  // ── Group C residential (multi-unit) ────────────────────────────────────
  if (occ.includes('C') || occ === '') {
    applicable.push({
      codeEntryId: 'OBC-GROUP-C-SUITE-SEP', code: 'OBC 2024 s.9.10', requirement: 'Suite fire separation (Group C)',
      affectedCSI: ['07', '09'], type: 'multiplier', multiplier: 1.025,
      description: 'Suite demising walls: 1-hour fire separation with acoustic treatment per OBC s.9.10 / s.9.11',
      reason: 'Probable Group C (residential) occupancy based on model metadata',
      requiresQsConfirmation: true,
    });
  }

  // ── Sprinkler ────────────────────────────────────────────────────────────
  if (storeys > 3 || gfa > 1400 || modelMetadata.sprinklered === true) {
    applicable.push({
      codeEntryId: 'OBC-SPRINKLER', code: 'OBC 2024 s.3.2.5.9 / NFPA 13R', requirement: 'Automatic sprinkler system',
      affectedCSI: ['21'], type: 'flatCost', flatCost: 22 * Math.max(gfa, 100),
      description: `NFPA 13R sprinkler system — estimated $22/m² × ${gfa.toFixed(0)} m² GFA`,
      reason: `>3 storeys or >1400 m² triggers mandatory sprinkler per OBC`,
      requiresQsConfirmation: true,
    });
  }

  // ── Elevator ─────────────────────────────────────────────────────────────
  if (modelMetadata.hasElevator || storeys > 3) {
    applicable.push({
      codeEntryId: 'TSSA-ELEVATOR', code: 'TSSA / OBC s.3.5', requirement: 'Elevator — TSSA regulated',
      affectedCSI: ['14'], type: 'flatCost', flatCost: 95000 * Math.max(1, storeys - 1),
      description: `Hydraulic/traction elevator — TSSA permit + inspection, ${Math.max(1, storeys-1)} stop(s) estimated`,
      reason: `${storeys} storeys — elevator required per OBC s.3.5.4`,
      requiresQsConfirmation: true,
    });
  }

  // ── Seismic (NBC Table C-2) ───────────────────────────────────────────────
  if (pga >= 0.2 || (modelMetadata.province === 'BC') || (modelMetadata.province === 'ON' && storeys > 4)) {
    applicable.push({
      codeEntryId: 'NBC-SEISMIC', code: 'NBC 2020 Div.B Part 4 s.4.1.8', requirement: 'Seismic design and detailing',
      affectedCSI: ['03', '05'], type: 'multiplier', multiplier: pga >= 0.35 ? 1.08 : 1.04,
      description: `Seismic detailing per NBC 2020 — PGA ${pga.toFixed(2)}g. Affects rebar quantity, connection design, and lateral bracing.`,
      reason: `Seismic PGA ${pga.toFixed(2)}g exceeds screening threshold`,
      requiresQsConfirmation: true,
    });
    notes.push(`Seismic adder at ${pga >= 0.35 ? '8%' : '4%'} on Div 03 + 05 (PGA ${pga.toFixed(2)}g).`);
  }

  // ── NECB / Energy Code ───────────────────────────────────────────────────
  applicable.push({
    codeEntryId: 'NECB-2017-ENHANCED', code: 'NECB 2017 / SB-10 (ON)', requirement: 'Enhanced thermal envelope',
    affectedCSI: ['07', '08'], type: 'multiplier', multiplier: 1.03,
    description: 'NECB 2017 / SB-10 compliance: enhanced insulation, triple-glazed windows, HRV units (Div 07 + 08)',
    reason: 'Ontario SB-10 applies to all new buildings',
    requiresQsConfirmation: true,
  });

  // ── Underground parkade ───────────────────────────────────────────────────
  if (modelMetadata.hasParkadeLevel) {
    applicable.push({
      codeEntryId: 'OBC-PARKADE-MECH', code: 'OBC 2024 s.3.6 / NFPA 88A', requirement: 'Parkade ventilation (CO monitoring)',
      affectedCSI: ['23'], type: 'flatCost', flatCost: 35000,
      description: 'CO detection and mechanical exhaust system for underground parkade per OBC s.3.6.6',
      reason: 'BIM model includes parkade level',
      requiresQsConfirmation: false,  // Always applies if parkade present
    });
  }

  // ── Combustible construction > 3 storeys ─────────────────────────────────
  if (isCombustible && storeys > 3) {
    applicable.push({
      codeEntryId: 'OBC-COMB-FIRE', code: 'OBC 2024 s.3.2.2', requirement: 'Enhanced fire protection (combustible)',
      affectedCSI: ['07', '09', '21'], type: 'multiplier', multiplier: 1.045,
      description: 'Combustible construction >3 storeys: enhanced fire-stop, intumescent paint, Type X assemblies',
      reason: `Combustible construction with ${storeys} storeys triggers OBC s.3.2.2 enhanced provisions`,
      requiresQsConfirmation: true,
    });
  }

  if (applicable.length === 0) {
    notes.push('No automatic adders triggered. Review OBC Part 9 for any project-specific requirements.');
  }

  return {
    applicableAdders: applicable,
    config: {
      province: (modelMetadata.province as any) || 'ON',
      occupancyGroup: occ || 'C',
      numberOfStoreys: storeys,
      buildingArea: gfa,
      constructionType: modelMetadata.constructionType ?? 'non-combustible',
      sprinklered: modelMetadata.sprinklered,
    },
    screenedAt: new Date().toISOString(),
    notes,
  };
}
