// server/estimator/benchmark-pack-civil.ts
// =============================================================================
// BENCHMARK PACK: CIVIL / SITE DEVELOPMENT — v1.0.0
// =============================================================================
//
// Licensable module for horizontal civil construction estimation.
// Covers roads, bridges, earthworks, retaining walls, stormwater, and site grading.
//
// IMPORTANT — METRICS NOTE:
//   Civil projects use varied measurement units depending on sub-type.
//   The core engine benchmarks against a single "cost per unit" where
//   the unit varies. The `notes` field on each benchmark clarifies
//   which unit applies. Users must provide projectQuantity in the
//   correct unit for the selected project type.
//
//   Roads:           projectQuantity in lane-km
//   Bridges:         projectQuantity in m² deck area
//   Tunnels:         projectQuantity in linear m
//   Earthworks:      projectQuantity in m³
//   Retaining walls: projectQuantity in m² face area
//   Stormwater:      projectQuantity in m³ storage (ponds) or linear m (pipe)
//   Parking:         projectQuantity in m²
//   Railway:         projectQuantity in track-km or m² platform
//   Marine:          projectQuantity in linear m berth/seawall
//
// Data sources: Ontario Provincial Standards, MTO highway cost data,
//               CIQS infrastructure database, municipal tender averages
// Price level: Ontario 2025 (CAD)
// =============================================================================

import type {
  BenchmarkPack, BenchmarkRange, ExpectedDivisions, DivisionProportion,
} from './benchmark-core';
import { registerBenchmarkPack } from './benchmark-core';

export type CivilProjectType =
  | 'civil-road-urban' | 'civil-road-rural' | 'civil-highway'
  | 'civil-bridge-steel' | 'civil-bridge-concrete' | 'civil-bridge-pedestrian'
  | 'civil-tunnel'
  | 'civil-earthworks-cut-fill' | 'civil-earthworks-grading'
  | 'civil-retaining-wall-gravity' | 'civil-retaining-wall-mse'
  | 'civil-stormwater-pond' | 'civil-stormwater-pipe'
  | 'civil-parking-surface'
  | 'civil-railway-track' | 'civil-railway-station'
  | 'civil-marine-dock' | 'civil-marine-seawall';

// ─── Cost Benchmarks (CAD, Ontario 2025) ─────────────────────────────────────
// Note: unit varies per type — see notes field

const BENCHMARKS: BenchmarkRange[] = [
  // Roads ($/lane-km — includes base, sub-base, asphalt, curbs, drainage)
  { projectType: 'civil-road-urban', typeName: 'Urban Road (full reconstruction)', costLow: 2800000, costMid: 4200000, costHigh: 6500000, source: 'MTO/CIQS 2025', year: 2025, notes: '$/lane-km; includes curb, sidewalk, drainage, utilities relocation' },
  { projectType: 'civil-road-rural', typeName: 'Rural Road', costLow: 800000, costMid: 1400000, costHigh: 2200000, source: 'MTO/CIQS 2025', year: 2025, notes: '$/lane-km; gravel shoulder, ditching, basic drainage' },
  { projectType: 'civil-highway', typeName: 'Highway / Expressway', costLow: 4500000, costMid: 7500000, costHigh: 14000000, source: 'MTO/CIQS 2025', year: 2025, notes: '$/lane-km; full depth pavement, barriers, signage, ITS' },

  // Bridges ($/m² deck area)
  { projectType: 'civil-bridge-steel', typeName: 'Bridge — Steel Girder', costLow: 4500, costMid: 6500, costHigh: 9500, source: 'MTO/CIQS 2025', year: 2025, notes: '$/m² deck area; includes substructure, bearings, barriers' },
  { projectType: 'civil-bridge-concrete', typeName: 'Bridge — Concrete (precast/cast-in-place)', costLow: 3800, costMid: 5500, costHigh: 8000, source: 'MTO/CIQS 2025', year: 2025, notes: '$/m² deck area; includes piers, abutments, approach slabs' },
  { projectType: 'civil-bridge-pedestrian', typeName: 'Bridge — Pedestrian / Cycling', costLow: 5000, costMid: 7500, costHigh: 12000, source: 'CIQS 2025', year: 2025, notes: '$/m² deck area; premium for architectural features' },

  // Tunnels ($/linear m)
  { projectType: 'civil-tunnel', typeName: 'Tunnel (cut-and-cover or bored)', costLow: 80000, costMid: 150000, costHigh: 350000, source: 'CIQS 2025', year: 2025, notes: '$/linear m; highly variable with ground conditions and diameter' },

  // Earthworks ($/m³)
  { projectType: 'civil-earthworks-cut-fill', typeName: 'Earthworks — Cut & Fill', costLow: 12, costMid: 22, costHigh: 45, source: 'OPSS/CIQS 2025', year: 2025, notes: '$/m³ in-place; varies with haul distance and soil type' },
  { projectType: 'civil-earthworks-grading', typeName: 'Site Grading (mass and fine)', costLow: 8, costMid: 18, costHigh: 35, source: 'OPSS/CIQS 2025', year: 2025, notes: '$/m² graded area; includes stripping, grading, compaction' },

  // Retaining Walls ($/m² face area)
  { projectType: 'civil-retaining-wall-gravity', typeName: 'Retaining Wall — Gravity / Cantilever (concrete)', costLow: 800, costMid: 1400, costHigh: 2500, source: 'CIQS 2025', year: 2025, notes: '$/m² face area; includes excavation, backfill, drainage' },
  { projectType: 'civil-retaining-wall-mse', typeName: 'Retaining Wall — MSE (mechanically stabilized earth)', costLow: 500, costMid: 850, costHigh: 1400, source: 'CIQS 2025', year: 2025, notes: '$/m² face area; includes reinforcement, select fill, facing panels' },

  // Stormwater
  { projectType: 'civil-stormwater-pond', typeName: 'Stormwater Management Pond', costLow: 25, costMid: 55, costHigh: 100, source: 'CIQS 2025', year: 2025, notes: '$/m³ active storage; includes grading, liner, outlet structure, landscaping' },
  { projectType: 'civil-stormwater-pipe', typeName: 'Storm Sewer System', costLow: 800, costMid: 1500, costHigh: 3000, source: 'OPSS/CIQS 2025', year: 2025, notes: '$/linear m; 300-900mm dia, includes manholes every 90-120m, bedding' },

  // Parking
  { projectType: 'civil-parking-surface', typeName: 'Surface Parking Lot', costLow: 80, costMid: 140, costHigh: 220, source: 'CIQS 2025', year: 2025, notes: '$/m²; includes base, asphalt, curbs, paint, lighting, drainage' },

  // Railway
  { projectType: 'civil-railway-track', typeName: 'Railway Track', costLow: 3500000, costMid: 6000000, costHigh: 12000000, source: 'CIQS 2025', year: 2025, notes: '$/track-km; includes ballast, ties, rail, signals, grade crossings' },
  { projectType: 'civil-railway-station', typeName: 'Railway / Transit Station Platform', costLow: 3500, costMid: 5500, costHigh: 8500, source: 'CIQS 2025', year: 2025, notes: '$/m² platform area; includes canopy, lighting, benches, signage' },

  // Marine
  { projectType: 'civil-marine-dock', typeName: 'Marine — Dock / Wharf', costLow: 25000, costMid: 45000, costHigh: 80000, source: 'CIQS 2025', year: 2025, notes: '$/linear m berth face; pile-supported concrete or timber' },
  { projectType: 'civil-marine-seawall', typeName: 'Marine — Seawall / Shore Protection', costLow: 8000, costMid: 18000, costHigh: 40000, source: 'CIQS 2025', year: 2025, notes: '$/linear m; sheet pile, gabion, or armour stone; varies with wave exposure' },
];

// ─── Expected CSI Divisions ──────────────────────────────────────────────────

const EXPECTED_DIVISIONS: ExpectedDivisions[] = [
  { projectType: 'civil-road-urban', divisions: ['02','03','05','31','32','33'] },
  { projectType: 'civil-road-rural', divisions: ['02','03','31','32'] },
  { projectType: 'civil-highway', divisions: ['02','03','05','31','32','34'] },
  { projectType: 'civil-bridge-steel', divisions: ['03','05','07','31','32'] },
  { projectType: 'civil-bridge-concrete', divisions: ['03','05','07','31','32'] },
  { projectType: 'civil-bridge-pedestrian', divisions: ['03','05','07','31'] },
  { projectType: 'civil-tunnel', divisions: ['02','03','05','07','31'] },
  { projectType: 'civil-earthworks-cut-fill', divisions: ['02','31'] },
  { projectType: 'civil-earthworks-grading', divisions: ['02','31','32'] },
  { projectType: 'civil-retaining-wall-gravity', divisions: ['03','05','31'] },
  { projectType: 'civil-retaining-wall-mse', divisions: ['03','05','31','32'] },
  { projectType: 'civil-stormwater-pond', divisions: ['02','31','33'] },
  { projectType: 'civil-stormwater-pipe', divisions: ['02','31','33'] },
  { projectType: 'civil-parking-surface', divisions: ['02','03','31','32','26'] },
  { projectType: 'civil-railway-track', divisions: ['02','03','05','31','34'] },
  { projectType: 'civil-railway-station', divisions: ['02','03','05','31','34'] },
  { projectType: 'civil-marine-dock', divisions: ['02','03','05','31','35'] },
  { projectType: 'civil-marine-seawall', divisions: ['02','03','05','31','35'] },
];

// ─── Division Proportions (typical for civil) ───────────────────────────────

const DIVISION_PROPORTIONS: DivisionProportion[] = [
  { division: '02', divisionName: 'Existing Conditions', expectedPercentLow: 0.02, expectedPercentHigh: 0.15 },
  { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.10, expectedPercentHigh: 0.40 },
  { division: '05', divisionName: 'Metals', expectedPercentLow: 0.00, expectedPercentHigh: 0.25 },
  { division: '31', divisionName: 'Earthwork', expectedPercentLow: 0.15, expectedPercentHigh: 0.50 },
  { division: '32', divisionName: 'Exterior Improvements', expectedPercentLow: 0.05, expectedPercentHigh: 0.35 },
  { division: '33', divisionName: 'Utilities', expectedPercentLow: 0.00, expectedPercentHigh: 0.20 },
  { division: '34', divisionName: 'Transportation', expectedPercentLow: 0.00, expectedPercentHigh: 0.30 },
  { division: '35', divisionName: 'Waterway/Marine', expectedPercentLow: 0.00, expectedPercentHigh: 0.40 },
];

// ─── Pack Registration ───────────────────────────────────────────────────────

const typeNameMap = new Map<string, string>();
for (const b of BENCHMARKS) typeNameMap.set(b.projectType, b.typeName);

export const CIVIL_PACK: BenchmarkPack = {
  category: 'civil',
  categoryName: 'Civil / Site Development',
  version: '1.0.0',
  metric: 'cost-per-linear-m',
  metricLabel: '$/unit (varies by type — see notes)',
  measurementUnit: 'varies',
  projectTypes: BENCHMARKS.map(b => b.projectType),
  benchmarks: BENCHMARKS,
  expectedDivisions: EXPECTED_DIVISIONS,
  divisionProportions: DIVISION_PROPORTIONS,
  getProjectTypeName: (type: string) => typeNameMap.get(type) || type,
};

registerBenchmarkPack(CIVIL_PACK);
