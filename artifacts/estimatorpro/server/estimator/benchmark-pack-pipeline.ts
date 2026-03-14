// server/estimator/benchmark-pack-pipeline.ts
// =============================================================================
// BENCHMARK PACK: PIPELINES & UTILITIES — v1.0.0
// =============================================================================
//
// Licensable module for linear utility construction estimation.
// Covers water mains, sanitary sewers, storm sewers, gas distribution,
// electrical distribution, telecommunications, and district energy.
//
// Primary metric: $/linear metre (pipe runs, duct banks)
// Secondary: $/connection (service laterals)
//
// UNIT GUIDANCE:
//   Pipe/duct runs: projectQuantity in linear metres
//   Service laterals: projectQuantity in number of connections
//
// Ranges are highly diameter-dependent. Benchmarks assume typical diameter
// for each sub-type. Notes specify diameter assumptions.
//
// Data sources: Ontario Clean Water Agency, municipal tender data,
//               Enbridge/Hydro One published cost guides, CIQS database
// Price level: Ontario 2025 (CAD)
// =============================================================================

import type {
  BenchmarkPack, BenchmarkRange, ExpectedDivisions, DivisionProportion,
} from './benchmark-core';
import { registerBenchmarkPack } from './benchmark-core';

export type PipelineProjectType =
  | 'pipe-watermain-small' | 'pipe-watermain-large' | 'pipe-watermain-transmission'
  | 'pipe-sanitary-gravity' | 'pipe-sanitary-forcemain' | 'pipe-sanitary-trunk'
  | 'pipe-storm-pipe' | 'pipe-storm-culvert'
  | 'pipe-gas-distribution' | 'pipe-gas-transmission'
  | 'pipe-oil-pipeline'
  | 'util-electrical-overhead' | 'util-electrical-underground'
  | 'util-telecom-fibre' | 'util-telecom-duct'
  | 'util-district-energy'
  | 'pipe-service-lateral-water' | 'pipe-service-lateral-sewer';

// ─── Cost Benchmarks (CAD, Ontario 2025) ─────────────────────────────────────

const BENCHMARKS: BenchmarkRange[] = [
  // Watermain ($/linear m — includes pipe, fittings, valves, hydrants, bedding, backfill)
  { projectType: 'pipe-watermain-small', typeName: 'Watermain — Small (150-200mm PVC/HDPE)', costLow: 350, costMid: 550, costHigh: 850, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/linear m; assumes 1.5-2.0m depth, open cut, urban conditions' },
  { projectType: 'pipe-watermain-large', typeName: 'Watermain — Large (300-450mm ductile iron)', costLow: 650, costMid: 1100, costHigh: 1800, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/linear m; includes thrust blocks, valve chambers, hydrants' },
  { projectType: 'pipe-watermain-transmission', typeName: 'Watermain — Transmission (600mm+ steel/DI)', costLow: 1500, costMid: 2800, costHigh: 5000, source: 'OCWA/CIQS 2025', year: 2025, notes: '$/linear m; includes cathodic protection, air/vacuum valves, chamber vaults' },

  // Sanitary Sewer ($/linear m)
  { projectType: 'pipe-sanitary-gravity', typeName: 'Sanitary Sewer — Gravity (200-375mm PVC)', costLow: 400, costMid: 700, costHigh: 1200, source: 'CIQS 2025', year: 2025, notes: '$/linear m; includes manholes every 90-120m, bedding, testing' },
  { projectType: 'pipe-sanitary-forcemain', typeName: 'Sanitary Sewer — Forcemain (150-300mm HDPE)', costLow: 350, costMid: 600, costHigh: 1000, source: 'CIQS 2025', year: 2025, notes: '$/linear m; includes air release valves, connections, flushing ports' },
  { projectType: 'pipe-sanitary-trunk', typeName: 'Trunk Sanitary Sewer (600mm+ concrete/PVC)', costLow: 1200, costMid: 2200, costHigh: 4500, source: 'CIQS 2025', year: 2025, notes: '$/linear m; deep installation 3-6m, large manholes, bypass pumping' },

  // Storm Sewer ($/linear m)
  { projectType: 'pipe-storm-pipe', typeName: 'Storm Sewer Pipe (300-900mm concrete/PVC)', costLow: 500, costMid: 1000, costHigh: 2000, source: 'OPSS/CIQS 2025', year: 2025, notes: '$/linear m; includes manholes, catch basins, bedding, backfill' },
  { projectType: 'pipe-storm-culvert', typeName: 'Culvert (pipe or box, 600mm-2400mm)', costLow: 800, costMid: 1800, costHigh: 4000, source: 'MTO/CIQS 2025', year: 2025, notes: '$/linear m; includes headwalls, wingwalls, scour protection, bedding' },

  // Gas ($/linear m)
  { projectType: 'pipe-gas-distribution', typeName: 'Gas Distribution (60-150mm PE)', costLow: 200, costMid: 380, costHigh: 650, source: 'Enbridge/CIQS 2025', year: 2025, notes: '$/linear m; includes PE pipe, fittings, tracing wire, valve boxes' },
  { projectType: 'pipe-gas-transmission', typeName: 'Gas Transmission (300mm+ steel)', costLow: 1500, costMid: 3000, costHigh: 6000, source: 'CER/CIQS 2025', year: 2025, notes: '$/linear m; includes cathodic protection, pig launchers/receivers, coatings' },

  // Oil ($/linear m)
  { projectType: 'pipe-oil-pipeline', typeName: 'Oil Pipeline (200-600mm steel)', costLow: 2000, costMid: 4000, costHigh: 8000, source: 'CER/CIQS 2025', year: 2025, notes: '$/linear m; includes coating, cathodic, valves, pump stations prorated' },

  // Electrical ($/linear m)
  { projectType: 'util-electrical-overhead', typeName: 'Electrical — Overhead Distribution (27.6kV)', costLow: 150, costMid: 300, costHigh: 550, source: 'Hydro One/CIQS 2025', year: 2025, notes: '$/linear m; includes poles, conductors, transformers, anchors' },
  { projectType: 'util-electrical-underground', typeName: 'Electrical — Underground Distribution', costLow: 500, costMid: 900, costHigh: 1600, source: 'Hydro One/CIQS 2025', year: 2025, notes: '$/linear m; includes duct bank, cable, splices, switchgear, padmounts' },

  // Telecom ($/linear m)
  { projectType: 'util-telecom-fibre', typeName: 'Telecommunications — Fibre Optic', costLow: 80, costMid: 160, costHigh: 300, source: 'CIQS 2025', year: 2025, notes: '$/linear m; includes micro-duct, fibre cable, splice enclosures, handholes' },
  { projectType: 'util-telecom-duct', typeName: 'Telecommunications — Duct Bank (multi-cell)', costLow: 300, costMid: 550, costHigh: 900, source: 'CIQS 2025', year: 2025, notes: '$/linear m; 4-cell PVC duct bank, concrete encased, pull boxes' },

  // District Energy ($/linear m)
  { projectType: 'util-district-energy', typeName: 'District Energy (pre-insulated hot water)', costLow: 1200, costMid: 2200, costHigh: 4000, source: 'CIQS 2025', year: 2025, notes: '$/linear m; twin pipe, insulated carrier, expansion loops, valve chambers' },

  // Service Laterals ($/connection)
  { projectType: 'pipe-service-lateral-water', typeName: 'Water Service Lateral (per connection)', costLow: 3500, costMid: 5500, costHigh: 9000, source: 'CIQS 2025', year: 2025, notes: '$/connection; 25-50mm, includes corp stop, curb stop, box, meter' },
  { projectType: 'pipe-service-lateral-sewer', typeName: 'Sewer Service Lateral (per connection)', costLow: 4000, costMid: 6500, costHigh: 10000, source: 'CIQS 2025', year: 2025, notes: '$/connection; 100-150mm, includes wye, cleanout, backfill, testing' },
];

// ─── Expected CSI Divisions ──────────────────────────────────────────────────

const EXPECTED_DIVISIONS: ExpectedDivisions[] = [
  { projectType: 'pipe-watermain-small', divisions: ['02','31','33'] },
  { projectType: 'pipe-watermain-large', divisions: ['02','03','31','33'] },
  { projectType: 'pipe-watermain-transmission', divisions: ['02','03','05','31','33'] },
  { projectType: 'pipe-sanitary-gravity', divisions: ['02','31','33'] },
  { projectType: 'pipe-sanitary-forcemain', divisions: ['02','03','31','33'] },
  { projectType: 'pipe-sanitary-trunk', divisions: ['02','03','05','31','33'] },
  { projectType: 'pipe-storm-pipe', divisions: ['02','31','33'] },
  { projectType: 'pipe-storm-culvert', divisions: ['02','03','31','33'] },
  { projectType: 'pipe-gas-distribution', divisions: ['02','31','33'] },
  { projectType: 'pipe-gas-transmission', divisions: ['02','03','05','31','33'] },
  { projectType: 'pipe-oil-pipeline', divisions: ['02','03','05','31','33','40'] },
  { projectType: 'util-electrical-overhead', divisions: ['02','26','31'] },
  { projectType: 'util-electrical-underground', divisions: ['02','26','31','33'] },
  { projectType: 'util-telecom-fibre', divisions: ['02','27','31','33'] },
  { projectType: 'util-telecom-duct', divisions: ['02','27','31','33'] },
  { projectType: 'util-district-energy', divisions: ['02','03','23','31','33'] },
  { projectType: 'pipe-service-lateral-water', divisions: ['02','31','33'] },
  { projectType: 'pipe-service-lateral-sewer', divisions: ['02','31','33'] },
];

// ─── Division Proportions ────────────────────────────────────────────────────

const DIVISION_PROPORTIONS: DivisionProportion[] = [
  { division: '02', divisionName: 'Existing Conditions', expectedPercentLow: 0.03, expectedPercentHigh: 0.15 },
  { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.00, expectedPercentHigh: 0.20 },
  { division: '31', divisionName: 'Earthwork', expectedPercentLow: 0.20, expectedPercentHigh: 0.50 },
  { division: '33', divisionName: 'Utilities', expectedPercentLow: 0.25, expectedPercentHigh: 0.60 },
];

// ─── Pack Registration ───────────────────────────────────────────────────────

const typeNameMap = new Map<string, string>();
for (const b of BENCHMARKS) typeNameMap.set(b.projectType, b.typeName);

export const PIPELINE_PACK: BenchmarkPack = {
  category: 'pipeline',
  categoryName: 'Pipelines & Utilities',
  version: '1.0.0',
  metric: 'cost-per-linear-m',
  metricLabel: '$/linear m (or $/connection for laterals)',
  measurementUnit: 'linear m',
  projectTypes: BENCHMARKS.map(b => b.projectType),
  benchmarks: BENCHMARKS,
  expectedDivisions: EXPECTED_DIVISIONS,
  divisionProportions: DIVISION_PROPORTIONS,
  getProjectTypeName: (type: string) => typeNameMap.get(type) || type,
};

registerBenchmarkPack(PIPELINE_PACK);
