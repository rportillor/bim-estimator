// server/estimator/benchmark-pack-mining.ts
// =============================================================================
// BENCHMARK PACK: MINING & HEAVY INDUSTRIAL — v1.0.0
// =============================================================================
//
// Licensable module for mining and heavy industrial estimation.
// Covers processing plants, camp/accommodation, tailings,
// environmental remediation/closure, and underground infrastructure.
//
// UNIT GUIDANCE:
//   Processing plants: projectQuantity in tonnes/day capacity
//   Aggregate/cement:  projectQuantity in tonnes/hour or tonnes/year
//   Camps:             projectQuantity in beds
//   Tailings:          projectQuantity in m³ storage
//   Environmental:     projectQuantity in hectares
//   Shafts:            projectQuantity in metres depth
//   Conveyors:         projectQuantity in linear metres
//   Loadout:           projectQuantity in tonnes/hour
//
// Data sources: CIM Capital Cost Estimation Handbook, NI 43-101 reports,
//               AACE heavy industrial standards, CIQS database
// Price level: Canadian average 2025 (CAD)
// Note: Mining costs are highly variable by location and remoteness.
//       Northern Ontario/Quebec add 20-40%. Remote fly-in add 50-100%.
// =============================================================================

import type {
  BenchmarkPack, BenchmarkRange, ExpectedDivisions, DivisionProportion,
} from './benchmark-core';
import { registerBenchmarkPack } from './benchmark-core';

export type MiningProjectType =
  | 'mining-processing-gold' | 'mining-processing-base-metal'
  | 'mining-processing-aggregate' | 'mining-processing-cement'
  | 'mining-camp-permanent' | 'mining-camp-temporary'
  | 'mining-tailings-conventional' | 'mining-tailings-lined'
  | 'mining-environmental-remediation' | 'mining-environmental-closure'
  | 'mining-headframe' | 'mining-shaft'
  | 'mining-conveyor' | 'mining-loadout';

// ─── Cost Benchmarks (CAD, 2025) ────────────────────────────────────────────

const BENCHMARKS: BenchmarkRange[] = [
  // Processing Plants ($/tonne/day capacity)
  { projectType: 'mining-processing-gold', typeName: 'Gold Processing Plant (CIL/CIP)', costLow: 18000, costMid: 30000, costHigh: 55000, source: 'CIM/AACE 2025', year: 2025, notes: '$/tonne/day capacity; includes crushing, grinding, leach, ADR, tailings thickener' },
  { projectType: 'mining-processing-base-metal', typeName: 'Base Metal Concentrator (Cu/Zn/Ni)', costLow: 15000, costMid: 25000, costHigh: 45000, source: 'CIM/AACE 2025', year: 2025, notes: '$/tonne/day capacity; includes crushing, SAG/ball mill, flotation, concentrate handling' },

  // Aggregate & Cement ($/tonne/hour or $/tonne/year)
  { projectType: 'mining-processing-aggregate', typeName: 'Aggregate / Crushing Plant', costLow: 50000, costMid: 100000, costHigh: 200000, source: 'CIQS 2025', year: 2025, notes: '$/tonne/hr capacity; portable or semi-portable, includes screening and conveyors' },
  { projectType: 'mining-processing-cement', typeName: 'Cement Plant', costLow: 250, costMid: 400, costHigh: 600, source: 'CIQS 2025', year: 2025, notes: '$/tonne/yr capacity; includes kiln, raw mill, cement mill, silos, packaging' },

  // Camp Accommodation ($/bed)
  { projectType: 'mining-camp-permanent', typeName: 'Camp — Permanent Accommodation', costLow: 120000, costMid: 200000, costHigh: 350000, source: 'AACE/CIQS 2025', year: 2025, notes: '$/bed; includes kitchen/dining, recreation, laundry, water/waste treatment' },
  { projectType: 'mining-camp-temporary', typeName: 'Camp — Temporary / Modular', costLow: 55000, costMid: 90000, costHigh: 150000, source: 'AACE/CIQS 2025', year: 2025, notes: '$/bed; modular units, shared facilities, temporary utilities' },

  // Tailings ($/m³ storage)
  { projectType: 'mining-tailings-conventional', typeName: 'Tailings Facility — Conventional Dam', costLow: 8, costMid: 18, costHigh: 35, source: 'CIM/AACE 2025', year: 2025, notes: '$/m³ storage capacity; includes dam construction, decant, seepage collection' },
  { projectType: 'mining-tailings-lined', typeName: 'Tailings Facility — Lined (HDPE/GCL)', costLow: 15, costMid: 30, costHigh: 55, source: 'CIM/AACE 2025', year: 2025, notes: '$/m³ storage; includes liner, underdrain, leak detection, embankment' },

  // Environmental ($/hectare)
  { projectType: 'mining-environmental-remediation', typeName: 'Environmental Remediation (contaminated soil)', costLow: 150000, costMid: 350000, costHigh: 800000, source: 'CIQS 2025', year: 2025, notes: '$/hectare; includes excavation, treatment/disposal, verification sampling, backfill' },
  { projectType: 'mining-environmental-closure', typeName: 'Mine Closure / Reclamation', costLow: 80000, costMid: 180000, costHigh: 450000, source: 'CIM/CIQS 2025', year: 2025, notes: '$/hectare; includes demolition, re-grading, capping, revegetation, monitoring wells' },

  // Underground ($/unit varies)
  { projectType: 'mining-headframe', typeName: 'Mine Headframe (steel)', costLow: 5000000, costMid: 12000000, costHigh: 25000000, source: 'CIM/AACE 2025', year: 2025, notes: 'Lump sum per headframe; projectQuantity = 1; varies with skip/cage size and depth' },
  { projectType: 'mining-shaft', typeName: 'Mine Shaft (raise-bored or conventional)', costLow: 15000, costMid: 30000, costHigh: 60000, source: 'CIM/AACE 2025', year: 2025, notes: '$/m depth; 5-7m diameter, includes lining, guides, services, stations' },

  // Material Handling
  { projectType: 'mining-conveyor', typeName: 'Conveyor System (overland)', costLow: 3000, costMid: 6000, costHigh: 12000, source: 'AACE/CIQS 2025', year: 2025, notes: '$/linear m; includes structure, belt, drives, transfer towers, idlers' },
  { projectType: 'mining-loadout', typeName: 'Loadout / Stockpile Facility', costLow: 80000, costMid: 150000, costHigh: 300000, source: 'AACE/CIQS 2025', year: 2025, notes: '$/tonne/hr capacity; includes stacker, reclaimer, bins, rail/truck loadout' },
];

// ─── Expected CSI Divisions ──────────────────────────────────────────────────

const EXPECTED_DIVISIONS: ExpectedDivisions[] = [
  { projectType: 'mining-processing-gold', divisions: ['02','03','05','07','09','22','23','26','40','41','43','44','46'] },
  { projectType: 'mining-processing-base-metal', divisions: ['02','03','05','07','09','22','23','26','40','41','43','44','46'] },
  { projectType: 'mining-processing-aggregate', divisions: ['02','03','05','26','31','41','44'] },
  { projectType: 'mining-processing-cement', divisions: ['02','03','05','07','23','26','40','41','43','44'] },
  { projectType: 'mining-camp-permanent', divisions: ['02','03','06','07','08','09','22','23','26'] },
  { projectType: 'mining-camp-temporary', divisions: ['02','03','06','07','08','09','22','23','26'] },
  { projectType: 'mining-tailings-conventional', divisions: ['02','31','33'] },
  { projectType: 'mining-tailings-lined', divisions: ['02','07','31','33'] },
  { projectType: 'mining-environmental-remediation', divisions: ['02','31','32','33'] },
  { projectType: 'mining-environmental-closure', divisions: ['02','31','32','33'] },
  { projectType: 'mining-headframe', divisions: ['02','03','05','14','26'] },
  { projectType: 'mining-shaft', divisions: ['02','03','05','14','26','31'] },
  { projectType: 'mining-conveyor', divisions: ['02','03','05','26','41'] },
  { projectType: 'mining-loadout', divisions: ['02','03','05','26','41','44'] },
];

// ─── Division Proportions ────────────────────────────────────────────────────

const DIVISION_PROPORTIONS: DivisionProportion[] = [
  { division: '02', divisionName: 'Existing Conditions', expectedPercentLow: 0.02, expectedPercentHigh: 0.10 },
  { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.08, expectedPercentHigh: 0.25 },
  { division: '05', divisionName: 'Metals', expectedPercentLow: 0.10, expectedPercentHigh: 0.30 },
  { division: '26', divisionName: 'Electrical', expectedPercentLow: 0.08, expectedPercentHigh: 0.20 },
  { division: '31', divisionName: 'Earthwork', expectedPercentLow: 0.05, expectedPercentHigh: 0.30 },
  { division: '40', divisionName: 'Process Integration', expectedPercentLow: 0.05, expectedPercentHigh: 0.25 },
  { division: '41', divisionName: 'Material Processing', expectedPercentLow: 0.05, expectedPercentHigh: 0.30 },
  { division: '44', divisionName: 'Pollution/Waste Control', expectedPercentLow: 0.00, expectedPercentHigh: 0.15 },
];

// ─── Pack Registration ───────────────────────────────────────────────────────

const typeNameMap = new Map<string, string>();
for (const b of BENCHMARKS) typeNameMap.set(b.projectType, b.typeName);

export const MINING_PACK: BenchmarkPack = {
  category: 'mining',
  categoryName: 'Mining & Heavy Industrial',
  version: '1.0.0',
  metric: 'cost-per-tonne',
  metricLabel: '$/unit (varies by type — see notes)',
  measurementUnit: 'varies',
  projectTypes: BENCHMARKS.map(b => b.projectType),
  benchmarks: BENCHMARKS,
  expectedDivisions: EXPECTED_DIVISIONS,
  divisionProportions: DIVISION_PROPORTIONS,
  getProjectTypeName: (type: string) => typeNameMap.get(type) || type,
};

registerBenchmarkPack(MINING_PACK);
