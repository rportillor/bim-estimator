// server/estimator/benchmark-pack-infrastructure.ts
// =============================================================================
// BENCHMARK PACK: INFRASTRUCTURE & PUBLIC WORKS — v1.0.0
// =============================================================================
//
// Licensable module for infrastructure and public works estimation.
// Covers water/wastewater treatment, transit stations, pumping stations,
// power generation/distribution, dam/reservoir structures, and airports.
//
// UNIT GUIDANCE:
//   Treatment plants:  projectQuantity in MLD (megalitres/day) capacity
//   Pumping stations:  projectQuantity in L/s capacity
//   Transit stations:  projectQuantity in m²
//   Power substations: projectQuantity in MVA
//   Solar/wind:        projectQuantity in MW installed
//   Dams (earth):      projectQuantity in m³ embankment
//   Dams (concrete):   projectQuantity in m³ concrete
//   Reservoirs:        projectQuantity in ML storage
//   Landfills:         projectQuantity in hectares
//   Airports:          projectQuantity in m²
//
// Data sources: Ontario Clean Water Agency, Infrastructure Ontario,
//               Metrolinx Class D/C estimates, IESO cost data, CIQS database
// Price level: Ontario 2025 (CAD)
// =============================================================================

import type {
  BenchmarkPack, BenchmarkRange, ExpectedDivisions, DivisionProportion,
} from './benchmark-core';
import { registerBenchmarkPack } from './benchmark-core';

export type InfrastructureProjectType =
  | 'infra-water-treatment' | 'infra-wastewater-treatment'
  | 'infra-pumping-water' | 'infra-pumping-sewage' | 'infra-pumping-stormwater'
  | 'infra-transit-station-surface' | 'infra-transit-station-underground'
  | 'infra-transit-maintenance'
  | 'infra-power-substation' | 'infra-power-solar' | 'infra-power-wind'
  | 'infra-dam-earth' | 'infra-dam-concrete' | 'infra-reservoir'
  | 'infra-landfill' | 'infra-recycling-facility'
  | 'infra-airport-terminal' | 'infra-airport-runway';

// ─── Cost Benchmarks (CAD, Ontario 2025) ─────────────────────────────────────

const BENCHMARKS: BenchmarkRange[] = [
  // Water & Wastewater Treatment ($/MLD capacity)
  { projectType: 'infra-water-treatment', typeName: 'Water Treatment Plant', costLow: 8000000, costMid: 14000000, costHigh: 25000000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/MLD capacity; conventional treatment, membrane adds 30-50%' },
  { projectType: 'infra-wastewater-treatment', typeName: 'Wastewater Treatment Plant', costLow: 10000000, costMid: 18000000, costHigh: 35000000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/MLD capacity; secondary treatment, tertiary adds 25-40%' },

  // Pumping Stations ($/L/s capacity)
  { projectType: 'infra-pumping-water', typeName: 'Water Pumping Station', costLow: 8000, costMid: 15000, costHigh: 28000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/L/s capacity; includes building, pumps, electrical, standby generator' },
  { projectType: 'infra-pumping-sewage', typeName: 'Sewage Pumping Station', costLow: 12000, costMid: 22000, costHigh: 40000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/L/s capacity; wet well, pumps, odour control, SCADA, standby power' },
  { projectType: 'infra-pumping-stormwater', typeName: 'Stormwater Pumping Station', costLow: 6000, costMid: 12000, costHigh: 22000, source: 'CIQS 2025', year: 2025, notes: '$/L/s capacity; large volume pumps, inlet structure, discharge piping' },

  // Transit ($/m²)
  { projectType: 'infra-transit-station-surface', typeName: 'Transit Station — Surface / Elevated', costLow: 6000, costMid: 10000, costHigh: 16000, source: 'Metrolinx/CIQS 2025', year: 2025, notes: '$/m² platform area; includes canopy, fare equipment, accessibility, MEP' },
  { projectType: 'infra-transit-station-underground', typeName: 'Transit Station — Underground', costLow: 20000, costMid: 40000, costHigh: 80000, source: 'Metrolinx/CIQS 2025', year: 2025, notes: '$/m² station floor area; includes excavation, tunnelling, finishes, ventilation' },
  { projectType: 'infra-transit-maintenance', typeName: 'Transit Maintenance / Storage Facility', costLow: 3000, costMid: 4500, costHigh: 7000, source: 'Metrolinx/CIQS 2025', year: 2025, notes: '$/m²; high-bay industrial, pits, overhead cranes, specialised MEP' },

  // Power (various)
  { projectType: 'infra-power-substation', typeName: 'Power Substation', costLow: 300000, costMid: 550000, costHigh: 1000000, source: 'IESO/Hydro One 2025', year: 2025, notes: '$/MVA capacity; includes transformers, switchgear, protection, civil works' },
  { projectType: 'infra-power-solar', typeName: 'Solar Farm / Installation', costLow: 1200000, costMid: 1600000, costHigh: 2200000, source: 'IESO/CIQS 2025', year: 2025, notes: '$/MW DC; includes panels, racking, inverters, interconnection, site work' },
  { projectType: 'infra-power-wind', typeName: 'Wind Farm / Installation', costLow: 1800000, costMid: 2400000, costHigh: 3500000, source: 'IESO/CIQS 2025', year: 2025, notes: '$/MW; includes turbines, foundations, collector system, substation' },

  // Dams & Reservoirs
  { projectType: 'infra-dam-earth', typeName: 'Dam — Earthfill', costLow: 35, costMid: 65, costHigh: 120, source: 'CIQS 2025', year: 2025, notes: '$/m³ embankment; includes core, filters, riprap, instrumentation' },
  { projectType: 'infra-dam-concrete', typeName: 'Dam — Concrete (gravity or arch)', costLow: 600, costMid: 1100, costHigh: 2000, source: 'CIQS 2025', year: 2025, notes: '$/m³ concrete; includes formwork, reinforcement, galleries, outlets' },
  { projectType: 'infra-reservoir', typeName: 'Reservoir / Storage Tank (concrete)', costLow: 2000000, costMid: 4000000, costHigh: 8000000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/ML capacity; prestressed concrete, includes roof, piping, SCADA' },

  // Waste Management
  { projectType: 'infra-landfill', typeName: 'Landfill / Waste Management Facility', costLow: 300000, costMid: 600000, costHigh: 1200000, source: 'CIQS 2025', year: 2025, notes: '$/hectare; includes liner, leachate collection, gas collection, capping' },
  { projectType: 'infra-recycling-facility', typeName: 'Recycling / Materials Recovery Facility', costLow: 3000, costMid: 4500, costHigh: 7000, source: 'CIQS 2025', year: 2025, notes: '$/m²; includes sorting equipment, conveyors, baling, tipping floor' },

  // Airports
  { projectType: 'infra-airport-terminal', typeName: 'Airport Terminal', costLow: 5500, costMid: 8000, costHigh: 14000, source: 'CIQS 2025', year: 2025, notes: '$/m² GFA; high-security, baggage, jetbridges, specialised MEP' },
  { projectType: 'infra-airport-runway', typeName: 'Airport Runway / Taxiway', costLow: 400, costMid: 700, costHigh: 1200, source: 'CIQS 2025', year: 2025, notes: '$/m²; includes PCC pavement, lighting, marking, drainage, ILS foundations' },
];

// ─── Expected CSI Divisions ──────────────────────────────────────────────────

const EXPECTED_DIVISIONS: ExpectedDivisions[] = [
  { projectType: 'infra-water-treatment', divisions: ['02','03','05','07','09','22','23','26','40','43','46'] },
  { projectType: 'infra-wastewater-treatment', divisions: ['02','03','05','07','09','22','23','26','40','43','46'] },
  { projectType: 'infra-pumping-water', divisions: ['02','03','05','22','26','40','43'] },
  { projectType: 'infra-pumping-sewage', divisions: ['02','03','05','22','26','40','43'] },
  { projectType: 'infra-pumping-stormwater', divisions: ['02','03','05','26','40','43'] },
  { projectType: 'infra-transit-station-surface', divisions: ['02','03','05','07','08','09','14','22','23','26','34'] },
  { projectType: 'infra-transit-station-underground', divisions: ['02','03','05','07','08','09','14','22','23','26','34'] },
  { projectType: 'infra-transit-maintenance', divisions: ['02','03','05','07','08','09','22','23','26','34'] },
  { projectType: 'infra-power-substation', divisions: ['02','03','05','26','31'] },
  { projectType: 'infra-power-solar', divisions: ['02','05','26','31','48'] },
  { projectType: 'infra-power-wind', divisions: ['02','03','05','26','31','48'] },
  { projectType: 'infra-dam-earth', divisions: ['02','03','05','31','33','35'] },
  { projectType: 'infra-dam-concrete', divisions: ['02','03','05','31','33','35'] },
  { projectType: 'infra-reservoir', divisions: ['02','03','05','07','31','33'] },
  { projectType: 'infra-landfill', divisions: ['02','07','31','33'] },
  { projectType: 'infra-recycling-facility', divisions: ['02','03','05','07','08','09','22','23','26','41'] },
  { projectType: 'infra-airport-terminal', divisions: ['02','03','05','07','08','09','14','21','22','23','26','27','28','34'] },
  { projectType: 'infra-airport-runway', divisions: ['02','03','31','32','34'] },
];

// ─── Division Proportions ────────────────────────────────────────────────────

const DIVISION_PROPORTIONS: DivisionProportion[] = [
  { division: '02', divisionName: 'Existing Conditions', expectedPercentLow: 0.02, expectedPercentHigh: 0.12 },
  { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.10, expectedPercentHigh: 0.35 },
  { division: '05', divisionName: 'Metals', expectedPercentLow: 0.05, expectedPercentHigh: 0.20 },
  { division: '26', divisionName: 'Electrical', expectedPercentLow: 0.08, expectedPercentHigh: 0.30 },
  { division: '31', divisionName: 'Earthwork', expectedPercentLow: 0.05, expectedPercentHigh: 0.25 },
  { division: '40', divisionName: 'Process Integration', expectedPercentLow: 0.00, expectedPercentHigh: 0.30 },
  { division: '43', divisionName: 'Process Gas/Liquid Handling', expectedPercentLow: 0.00, expectedPercentHigh: 0.25 },
];

// ─── Pack Registration ───────────────────────────────────────────────────────

const typeNameMap = new Map<string, string>();
for (const b of BENCHMARKS) typeNameMap.set(b.projectType, b.typeName);

export const INFRASTRUCTURE_PACK: BenchmarkPack = {
  category: 'infrastructure',
  categoryName: 'Infrastructure & Public Works',
  version: '1.0.0',
  metric: 'cost-per-unit',
  metricLabel: '$/unit (varies by type — see notes)',
  measurementUnit: 'varies',
  projectTypes: BENCHMARKS.map(b => b.projectType),
  benchmarks: BENCHMARKS,
  expectedDivisions: EXPECTED_DIVISIONS,
  divisionProportions: DIVISION_PROPORTIONS,
  getProjectTypeName: (type: string) => typeNameMap.get(type) || type,
};

registerBenchmarkPack(INFRASTRUCTURE_PACK);
