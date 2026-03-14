// server/seed-rates.ts
// =============================================================================
// Seed script: populates unit_rates, mep_rates, and regional_factors tables
// from the existing hardcoded constants.
// =============================================================================
//
// Usage: call seedRateTables() once at server startup (after DB migrations).
// The function is idempotent — it checks whether unit_rates already has data
// and skips seeding if so.

import { storage } from './storage';
import { CSI_RATES } from './estimator/estimate-engine';
import {
  CANADIAN_PROVINCIAL_FACTORS,
} from './canadian-cost-data';
import {
  DIV_21_FIRE_SUPPRESSION,
  DIV_22_PLUMBING,
  DIV_23_HVAC,
  DIV_26_ELECTRICAL,
  DIV_27_COMMUNICATIONS,
  DIV_28_ELECTRONIC_SAFETY,
  type MEPRateItem,
} from './estimator/ontario-mep-rates';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a human-readable description from a CSI_RATES key.
 * Key format: '011000-GENERAL' → 'General' (title-cased suffix).
 */
function descriptionFromKey(key: string): string {
  const suffix = key.split('-').slice(1).join('-');
  if (!suffix) return key;
  return suffix
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Extract the province/territory from a regional factor key.
 * Key format: 'Ontario - GTA' → 'Ontario'
 *             'Prince Edward Island' → 'Prince Edward Island'
 */
function provinceFromKey(key: string): string {
  const dashIdx = key.indexOf(' - ');
  return dashIdx >= 0 ? key.substring(0, dashIdx) : key;
}

/**
 * Map a division array name constant to its two-digit division code.
 */
function divisionCode(item: MEPRateItem): string {
  // CSI code format: '21 13 13.10' — first two characters are the division
  return item.csiCode.substring(0, 2);
}

// ─── Main seed function ───────────────────────────────────────────────────────

export async function seedRateTables(): Promise<void> {
  // ── Guard: check each table independently ──
  const existingUnitRates = await storage.getUnitRates();
  const existingMepRates = await storage.getMepRates().catch(() => []);
  const existingRegionalFactors = await storage.getRegionalFactors().catch(() => []);

  const hasUnitRates = existingUnitRates.length > 0;
  const hasMepRates = (existingMepRates as any[]).length > 0;
  const hasRegionalFactors = (existingRegionalFactors as any[]).length > 0;

  if (hasUnitRates && hasMepRates && hasRegionalFactors) {
    console.log(`[seed-rates] All rate tables populated — skipping seed.`);
    return;
  }

  console.log('[seed-rates] Seeding rate tables from hardcoded constants...');

  // ── 1. Seed unit_rates from CSI_RATES ──────────────────────────────────────

  let unitRateCount = 0;
  if (hasUnitRates) {
    console.log(`[seed-rates]   unit_rates already has ${existingUnitRates.length} rows — skipping.`);
  } else
  for (const [key, rate] of Object.entries(CSI_RATES)) {
    await storage.upsertUnitRate({
      csiCode: key,
      description: descriptionFromKey(key),
      unit: rate.unit,
      materialRate: String(rate.materialRate),
      laborRate: String(rate.laborRate),
      equipmentRate: String(rate.equipmentRate),
      crewSize: String(rate.crewSize),
      productivityRate: String(rate.productivityRate),
      source: 'system_default',
      region: null,
    });
    unitRateCount++;
  }
  if (unitRateCount > 0) console.log(`[seed-rates]   Inserted ${unitRateCount} unit rates from CSI_RATES`);

  // ── 2. Seed regional_factors from CANADIAN_PROVINCIAL_FACTORS ──────────────

  let regionalCount = 0;
  if (hasRegionalFactors) {
    console.log(`[seed-rates]   regional_factors already populated — skipping.`);
  } else
  for (const [key, factor] of Object.entries(CANADIAN_PROVINCIAL_FACTORS)) {
    await storage.upsertRegionalFactor({
      regionKey: key,
      regionLabel: key,
      province: provinceFromKey(key),
      compositeIndex: String(factor.compositeIndex),
      materialIndex: String(factor.materialIndex),
      laborIndex: String(factor.laborIndex),
      equipmentIndex: String(factor.equipmentIndex),
      transportFactor: String(factor.transportFactor),
      remoteFactor: String(factor.remoteFactor),
      hstGstRate: String(factor.hstGstRate),
      pstRate: '0.000',
      taxDescription: factor.taxDescription,
      source: factor.bcpiSource ?? null,
    });
    regionalCount++;
  }
  if (regionalCount > 0) console.log(`[seed-rates]   Inserted ${regionalCount} regional factors from CANADIAN_PROVINCIAL_FACTORS`);

  // ── 3. Seed mep_rates from ontario-mep-rates division arrays ───────────────

  let mepCount = 0;
  if (hasMepRates) {
    console.log(`[seed-rates]   mep_rates already populated — skipping.`);
  } else {

  const mepDivisions: { label: string; items: MEPRateItem[] }[] = [
    { label: 'DIV_21', items: DIV_21_FIRE_SUPPRESSION },
    { label: 'DIV_22', items: DIV_22_PLUMBING },
    { label: 'DIV_23', items: DIV_23_HVAC },
    { label: 'DIV_26', items: DIV_26_ELECTRICAL },
    { label: 'DIV_27', items: DIV_27_COMMUNICATIONS },
    { label: 'DIV_28', items: DIV_28_ELECTRONIC_SAFETY },
  ];

  for (const { items } of mepDivisions) {
    for (const item of items) {
      await storage.upsertMepRate({
        csiCode: item.csiCode,
        division: divisionCode(item),
        description: item.description,
        unit: item.unit,
        materialRate: String(item.materialCAD),
        labourRate: String(item.labourCAD),
        unitRate: String(item.totalCAD),
        labourHoursPerUnit: String(item.labourHrs),
        source: 'system_default',
        region: 'Ontario - GTA',
        note: item.notes ?? null,
      });
      mepCount++;
    }
  }
  if (mepCount > 0) console.log(`[seed-rates]   Inserted ${mepCount} MEP rates from ontario-mep-rates`);

  } // end hasMepRates guard

  console.log(`[seed-rates] Seed complete. Totals: ${unitRateCount} unit rates, ${regionalCount} regional factors, ${mepCount} MEP rates.`);
}
