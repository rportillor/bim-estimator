// server/estimator/benchmark-pack-building.ts
// =============================================================================
// BENCHMARK PACK: BUILDING CONSTRUCTION
// =============================================================================
//
// Licensable module for vertical building construction estimation.
// Covers 46 building types across 10 sub-categories.
// Benchmark metric: $/m² GFA (Gross Floor Area)
//
// Data sources: CIQS Elemental Cost Analysis, RSMeans Canadian Square Foot Costs
// Price level: Ontario 2025 (adjust via provincial factors for other regions)
// =============================================================================

import type {
  BenchmarkPack, BenchmarkRange, ExpectedDivisions, DivisionProportion,
} from './benchmark-core';
import { registerBenchmarkPack } from './benchmark-core';

// ─── Building Project Types ──────────────────────────────────────────────────

export type BuildingProjectType =
  // Residential (8)
  | 'residential-single-family' | 'residential-townhouse' | 'residential-lowrise'
  | 'residential-midrise' | 'residential-highrise'
  | 'residential-seniors' | 'residential-social' | 'residential-student'
  // Commercial (4)
  | 'commercial-office' | 'commercial-retail'
  | 'commercial-parking' | 'commercial-restaurant'
  // Institutional (10)
  | 'institutional-education' | 'institutional-daycare' | 'institutional-government'
  | 'institutional-recreation' | 'institutional-library' | 'institutional-religious'
  | 'institutional-correctional' | 'institutional-fire-police'
  | 'institutional-lab-research' | 'institutional-museum' | 'institutional-arena'
  // Healthcare (5)
  | 'institutional-healthcare' | 'healthcare-longterm' | 'healthcare-clinic'
  | 'healthcare-dental' | 'healthcare-veterinary'
  // Industrial (5)
  | 'industrial-light' | 'industrial-heavy' | 'industrial-coldstorage'
  | 'industrial-foodprocessing' | 'industrial-manufacturing'
  // Hospitality (1)
  | 'hospitality'
  // Mixed-Use & Renovation (3)
  | 'mixed-use' | 'renovation-interior' | 'renovation-heritage'
  // Data Center & Warehouse (2)
  | 'commercial-datacenter' | 'commercial-warehouse'
  // Agricultural (2)
  | 'agricultural-barn' | 'agricultural-greenhouse';

// ─── Cost Benchmarks (CAD/m² GFA, Ontario 2025) ─────────────────────────────

const BENCHMARKS: BenchmarkRange[] = [
  // ── RESIDENTIAL ──
  { projectType: 'residential-single-family', typeName: 'Residential — Single-Family Detached', costLow: 2400, costMid: 3200, costHigh: 5000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-townhouse', typeName: 'Residential — Townhouse / Row Housing', costLow: 2600, costMid: 3300, costHigh: 4500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-lowrise', typeName: 'Residential — Low-Rise Apartment (1-4 storeys)', costLow: 2800, costMid: 3500, costHigh: 4500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-midrise', typeName: 'Residential — Mid-Rise (5-12 storeys)', costLow: 3200, costMid: 4200, costHigh: 5500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-highrise', typeName: 'Residential — High-Rise (13+ storeys)', costLow: 3800, costMid: 5000, costHigh: 6800, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-seniors', typeName: 'Residential — Seniors / Retirement Living', costLow: 3200, costMid: 4400, costHigh: 6000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-social', typeName: 'Residential — Social / Affordable Housing', costLow: 2600, costMid: 3400, costHigh: 4200, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'residential-student', typeName: 'Residential — Student Housing / Dormitory', costLow: 3000, costMid: 4000, costHigh: 5200, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── COMMERCIAL ──
  { projectType: 'commercial-office', typeName: 'Commercial — Office', costLow: 3200, costMid: 4500, costHigh: 6500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'commercial-retail', typeName: 'Commercial — Retail', costLow: 2200, costMid: 3200, costHigh: 4800, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'commercial-parking', typeName: 'Commercial — Parking Structure', costLow: 1200, costMid: 1800, costHigh: 2800, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'commercial-datacenter', typeName: 'Commercial — Data Center', costLow: 8000, costMid: 12000, costHigh: 20000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'commercial-warehouse', typeName: 'Commercial — Warehouse / Distribution', costLow: 1400, costMid: 2000, costHigh: 3000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'commercial-restaurant', typeName: 'Commercial — Restaurant / Food Service', costLow: 3500, costMid: 5000, costHigh: 8000, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── INSTITUTIONAL ──
  { projectType: 'institutional-education', typeName: 'Institutional — Education (K-12 / Post-Secondary)', costLow: 3800, costMid: 5200, costHigh: 7000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-daycare', typeName: 'Institutional — Daycare / Early Learning', costLow: 3200, costMid: 4200, costHigh: 5500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-government', typeName: 'Institutional — Government / Municipal Office', costLow: 3500, costMid: 5000, costHigh: 7000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-recreation', typeName: 'Institutional — Recreation / Community Centre', costLow: 3500, costMid: 4800, costHigh: 6500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-library', typeName: 'Institutional — Library / Cultural', costLow: 4000, costMid: 5500, costHigh: 7500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-religious', typeName: 'Institutional — Place of Worship', costLow: 2500, costMid: 3800, costHigh: 6000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-correctional', typeName: 'Institutional — Correctional Facility', costLow: 5500, costMid: 7500, costHigh: 10000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-fire-police', typeName: 'Institutional — Fire / Police Station', costLow: 4000, costMid: 5500, costHigh: 7500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-lab-research', typeName: 'Institutional — Research Laboratory', costLow: 6000, costMid: 8500, costHigh: 14000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-museum', typeName: 'Institutional — Museum / Gallery', costLow: 4500, costMid: 6500, costHigh: 10000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'institutional-arena', typeName: 'Institutional — Arena / Sports Venue', costLow: 3500, costMid: 5500, costHigh: 9000, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── HEALTHCARE ──
  { projectType: 'institutional-healthcare', typeName: 'Healthcare — Hospital (Acute Care)', costLow: 5000, costMid: 7000, costHigh: 9500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'healthcare-longterm', typeName: 'Healthcare — Long-Term Care', costLow: 3800, costMid: 5200, costHigh: 7000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'healthcare-clinic', typeName: 'Healthcare — Medical Clinic / Urgent Care', costLow: 3200, costMid: 4500, costHigh: 6500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'healthcare-dental', typeName: 'Healthcare — Dental Office', costLow: 2800, costMid: 4000, costHigh: 5500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'healthcare-veterinary', typeName: 'Healthcare — Veterinary Clinic', costLow: 2800, costMid: 3800, costHigh: 5500, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── INDUSTRIAL ──
  { projectType: 'industrial-light', typeName: 'Industrial — Light', costLow: 1800, costMid: 2500, costHigh: 3500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'industrial-heavy', typeName: 'Industrial — Heavy', costLow: 2800, costMid: 4000, costHigh: 6000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'industrial-coldstorage', typeName: 'Industrial — Cold Storage / Refrigerated', costLow: 2500, costMid: 3500, costHigh: 5000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'industrial-foodprocessing', typeName: 'Industrial — Food Processing', costLow: 3000, costMid: 4500, costHigh: 6500, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'industrial-manufacturing', typeName: 'Industrial — Manufacturing', costLow: 2200, costMid: 3200, costHigh: 5000, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── AGRICULTURAL ──
  { projectType: 'agricultural-barn', typeName: 'Agricultural — Barn / Farm Building', costLow: 800, costMid: 1400, costHigh: 2200, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'agricultural-greenhouse', typeName: 'Agricultural — Greenhouse', costLow: 600, costMid: 1200, costHigh: 2500, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── HOSPITALITY ──
  { projectType: 'hospitality', typeName: 'Hospitality — Hotel / Resort', costLow: 3500, costMid: 5000, costHigh: 7500, source: 'CIQS/RSMeans 2025', year: 2025 },

  // ── MIXED-USE & RENOVATION ──
  { projectType: 'mixed-use', typeName: 'Mixed-Use (Residential / Commercial)', costLow: 3000, costMid: 4200, costHigh: 5800, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'renovation-interior', typeName: 'Renovation — Interior Fit-Out / Retrofit', costLow: 1500, costMid: 2800, costHigh: 5000, source: 'CIQS/RSMeans 2025', year: 2025 },
  { projectType: 'renovation-heritage', typeName: 'Renovation — Heritage Building Restoration', costLow: 3500, costMid: 6000, costHigh: 12000, source: 'CIQS/RSMeans 2025', year: 2025 },
];

// ─── Expected CSI Divisions by Building Type ─────────────────────────────────

const EXPECTED_DIVISIONS: ExpectedDivisions[] = [
  // Residential
  { projectType: 'residential-single-family', divisions: ['03','06','07','08','09','22','23','26'] },
  { projectType: 'residential-townhouse', divisions: ['03','06','07','08','09','22','23','26'] },
  { projectType: 'residential-lowrise', divisions: ['03','05','06','07','08','09','22','23','26'] },
  { projectType: 'residential-midrise', divisions: ['03','04','05','07','08','09','14','22','23','26'] },
  { projectType: 'residential-highrise', divisions: ['03','05','07','08','09','14','21','22','23','26'] },
  { projectType: 'residential-seniors', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'residential-social', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'residential-student', divisions: ['03','05','07','08','09','14','22','23','26'] },

  // Commercial
  { projectType: 'commercial-office', divisions: ['03','05','07','08','09','14','21','22','23','26','27','28'] },
  { projectType: 'commercial-retail', divisions: ['03','05','07','08','09','21','22','23','26'] },
  { projectType: 'commercial-parking', divisions: ['03','05','07','09','14','22','26'] },
  { projectType: 'commercial-datacenter', divisions: ['03','05','07','08','09','21','22','23','25','26','27','28'] },
  { projectType: 'commercial-warehouse', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'commercial-restaurant', divisions: ['03','05','07','08','09','21','22','23','26'] },

  // Institutional
  { projectType: 'institutional-education', divisions: ['03','04','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'institutional-daycare', divisions: ['03','06','07','08','09','22','23','26'] },
  { projectType: 'institutional-government', divisions: ['03','05','07','08','09','14','21','22','23','26','27','28'] },
  { projectType: 'institutional-recreation', divisions: ['03','05','07','08','09','21','22','23','26'] },
  { projectType: 'institutional-library', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'institutional-religious', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'institutional-correctional', divisions: ['03','05','07','08','09','10','14','21','22','23','26','27','28'] },
  { projectType: 'institutional-fire-police', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'institutional-lab-research', divisions: ['03','05','07','08','09','14','21','22','23','25','26','27','28'] },
  { projectType: 'institutional-museum', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'institutional-arena', divisions: ['03','05','07','08','09','14','21','22','23','26'] },

  // Healthcare
  { projectType: 'institutional-healthcare', divisions: ['03','05','07','08','09','14','21','22','23','25','26','27','28'] },
  { projectType: 'healthcare-longterm', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'healthcare-clinic', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'healthcare-dental', divisions: ['03','07','08','09','22','23','26'] },
  { projectType: 'healthcare-veterinary', divisions: ['03','07','08','09','22','23','26'] },

  // Industrial
  { projectType: 'industrial-light', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'industrial-heavy', divisions: ['03','05','07','08','09','22','23','26','40','41'] },
  { projectType: 'industrial-coldstorage', divisions: ['03','05','07','08','09','22','23','26'] },
  { projectType: 'industrial-foodprocessing', divisions: ['03','05','07','08','09','21','22','23','26','40','46'] },
  { projectType: 'industrial-manufacturing', divisions: ['03','05','07','08','09','22','23','26','41'] },

  // Agricultural
  { projectType: 'agricultural-barn', divisions: ['03','05','06','07','08','22','26'] },
  { projectType: 'agricultural-greenhouse', divisions: ['03','05','07','08','22','23','26'] },

  // Hospitality
  { projectType: 'hospitality', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },

  // Mixed-Use & Renovation
  { projectType: 'mixed-use', divisions: ['03','05','07','08','09','14','21','22','23','26','27'] },
  { projectType: 'renovation-interior', divisions: ['06','07','08','09','22','23','26'] },
  { projectType: 'renovation-heritage', divisions: ['02','03','04','06','07','08','09','22','23','26'] },
];

// ─── Division Proportion Benchmarks (typical for buildings) ──────────────────

const DIVISION_PROPORTIONS: DivisionProportion[] = [
  { division: '01', divisionName: 'General Requirements', expectedPercentLow: 0.02, expectedPercentHigh: 0.08 },
  { division: '02', divisionName: 'Existing Conditions', expectedPercentLow: 0.00, expectedPercentHigh: 0.08 },
  { division: '03', divisionName: 'Concrete', expectedPercentLow: 0.05, expectedPercentHigh: 0.30 },
  { division: '04', divisionName: 'Masonry', expectedPercentLow: 0.00, expectedPercentHigh: 0.12 },
  { division: '05', divisionName: 'Metals', expectedPercentLow: 0.03, expectedPercentHigh: 0.20 },
  { division: '06', divisionName: 'Wood/Plastics/Composites', expectedPercentLow: 0.00, expectedPercentHigh: 0.18 },
  { division: '07', divisionName: 'Thermal/Moisture Protection', expectedPercentLow: 0.03, expectedPercentHigh: 0.12 },
  { division: '08', divisionName: 'Openings', expectedPercentLow: 0.03, expectedPercentHigh: 0.12 },
  { division: '09', divisionName: 'Finishes', expectedPercentLow: 0.06, expectedPercentHigh: 0.18 },
  { division: '10', divisionName: 'Specialties', expectedPercentLow: 0.01, expectedPercentHigh: 0.05 },
  { division: '14', divisionName: 'Conveying Equipment', expectedPercentLow: 0.00, expectedPercentHigh: 0.08 },
  { division: '21', divisionName: 'Fire Suppression', expectedPercentLow: 0.01, expectedPercentHigh: 0.05 },
  { division: '22', divisionName: 'Plumbing', expectedPercentLow: 0.03, expectedPercentHigh: 0.10 },
  { division: '23', divisionName: 'HVAC', expectedPercentLow: 0.06, expectedPercentHigh: 0.18 },
  { division: '26', divisionName: 'Electrical', expectedPercentLow: 0.06, expectedPercentHigh: 0.16 },
];

// ─── Name Lookup ─────────────────────────────────────────────────────────────

const typeNameMap = new Map<string, string>();
for (const b of BENCHMARKS) {
  typeNameMap.set(b.projectType, b.typeName);
}

// ─── Pack Definition & Registration ──────────────────────────────────────────

export const BUILDING_PACK: BenchmarkPack = {
  category: 'building',
  categoryName: 'Building Construction',
  version: '1.0.0',
  metric: 'cost-per-m2-gfa',
  metricLabel: '$/m² GFA',
  measurementUnit: 'm²',
  projectTypes: BENCHMARKS.map(b => b.projectType),
  benchmarks: BENCHMARKS,
  expectedDivisions: EXPECTED_DIVISIONS,
  divisionProportions: DIVISION_PROPORTIONS,
  getProjectTypeName: (type: string) => typeNameMap.get(type) || type,
};

// Auto-register on import
registerBenchmarkPack(BUILDING_PACK);
