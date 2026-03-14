// server/estimator/labor-burden.ts
// =============================================================================
// LABOR BURDEN CALCULATOR
// =============================================================================
//
// Master Priority Item #21
//
// Purpose:
//   1. Calculate full loaded labor rates from base wages
//   2. Track statutory burdens (CPP, EI, WSIB, EHT, vacation pay)
//   3. Track fringe benefits (health, dental, pension, training)
//   4. Calculate union vs non-union rates
//   5. Apply trade-specific burden rates
//   6. Ontario 2025 statutory rates pre-populated
//   7. Support crew composition for blended rates
//
// Standards: Ontario Employment Standards Act, WSIB rate groups,
//            CRA payroll requirements, CIQS labor costing practices
// =============================================================================

import type { EstimateSummary as _EstimateSummary } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface StatutoryBurden {
  name: string;                    // e.g., "CPP", "EI", "WSIB"
  description: string;
  rate: number;                    // Decimal (0.0595 = 5.95%)
  basis: 'gross-wages' | 'insurable-earnings' | 'assessable-payroll';
  annualMaximum?: number;          // Annual ceiling if applicable
  employerOnly: boolean;           // True if employer-only contribution
  notes?: string;
}

export interface FringeBenefit {
  name: string;                    // e.g., "Health & Dental", "Pension"
  type: 'percent' | 'hourly' | 'monthly';
  rate: number;                    // % of wages, $/hr, or $/month
  notes?: string;
}

export interface TradeRate {
  tradeCode: string;               // e.g., "CARP", "IRON", "ELEC"
  tradeName: string;               // e.g., "Carpenter", "Ironworker"
  baseWageHourly: number;          // $/hr base wage (Ontario 2025)
  unionLocal?: string;             // e.g., "LiUNA 183", "IBEW 353"
  isUnion: boolean;
  fringeBenefits: FringeBenefit[];
  wsibRateGroup: string;           // WSIB rate group code
  wsibRate: number;                // WSIB premium rate ($/100 of assessable)
  productivityFactor: number;      // 1.0 = standard, 0.85 = 85% productive
  notes?: string;
}

export interface LoadedLaborRate {
  tradeCode: string;
  tradeName: string;
  baseWage: number;
  statutoryBurden: number;         // CPP + EI + WSIB + EHT + vacation
  fringeBurden: number;            // Benefits, pension, training
  totalBurden: number;
  burdenPercent: number;           // Total burden as % of base wage
  loadedRate: number;              // Base + total burden
  effectiveRate: number;           // Loaded rate / productivity factor
  breakdown: {
    item: string;
    amount: number;
  }[];
}

export interface CrewComposition {
  crewId: string;
  crewName: string;                // e.g., "Concrete Crew", "Steel Erection Crew"
  members: {
    tradeCode: string;
    count: number;
    hoursPerDay: number;
  }[];
  equipmentCostPerDay?: number;    // Crew equipment if applicable
}

export interface CrewRate {
  crewId: string;
  crewName: string;
  totalMembersCount: number;
  dailyCost: number;
  hourlyCost: number;
  laborOnlyCost: number;
  equipmentCost: number;
  memberBreakdown: {
    tradeCode: string;
    tradeName: string;
    count: number;
    loadedRate: number;
    dailyCost: number;
  }[];
}

export interface LaborBurdenSummary {
  province: string;
  year: number;
  statutoryBurdens: StatutoryBurden[];
  totalStatutoryPercent: number;
  tradeRates: LoadedLaborRate[];
  crewRates: CrewRate[];
  averageBurdenPercent: number;
  generatedAt: string;
}

// ─── Ontario 2025 Statutory Burdens ──────────────────────────────────────────

const ONTARIO_2025_STATUTORY: StatutoryBurden[] = [
  {
    name: 'CPP2',
    description: 'Canada Pension Plan (employer share)',
    rate: 0.0595,
    basis: 'gross-wages',
    annualMaximum: 4055.50,
    employerOnly: false,
    notes: 'Employer matches employee contribution; max pensionable earnings $71,300',
  },
  {
    name: 'EI',
    description: 'Employment Insurance (employer share)',
    rate: 0.02282,
    basis: 'insurable-earnings',
    annualMaximum: 1049.12,
    employerOnly: false,
    notes: 'Employer pays 1.4x employee rate; max insurable earnings $65,700',
  },
  {
    name: 'WSIB',
    description: 'Workplace Safety & Insurance Board',
    rate: 0.0, // Applied per trade via wsibRate field
    basis: 'assessable-payroll',
    employerOnly: true,
    notes: 'Rate varies by trade/rate group — see individual trade rates',
  },
  {
    name: 'EHT',
    description: 'Employer Health Tax (Ontario)',
    rate: 0.0195,
    basis: 'gross-wages',
    employerOnly: true,
    notes: 'Ontario payrolls over $5M: 1.95%. Under $1M: exempt. $1M-$5M: graduated',
  },
  {
    name: 'Vacation Pay',
    description: 'Vacation pay (minimum 4% ESA)',
    rate: 0.04,
    basis: 'gross-wages',
    employerOnly: true,
    notes: 'ESA minimum 4% (2 weeks). Union agreements may be higher (6-10%)',
  },
  {
    name: 'Public Holidays',
    description: 'Ontario statutory holidays (9 days)',
    rate: 0.036,
    basis: 'gross-wages',
    employerOnly: true,
    notes: '9 public holidays / 250 working days = 3.6%',
  },
];

// ─── Ontario 2025 Trade Rates ────────────────────────────────────────────────
// Base wages from ICI collective agreements and open-shop surveys

const ONTARIO_2025_TRADES: TradeRate[] = [
  { tradeCode: 'LAB-GEN', tradeName: 'General Labourer', baseWageHourly: 32.50, isUnion: true, unionLocal: 'LiUNA 183', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.85,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 3.75 },
      { name: 'Pension', type: 'hourly', rate: 4.25 },
      { name: 'Training', type: 'hourly', rate: 0.65 },
      { name: 'Industry Fund', type: 'hourly', rate: 0.45 },
    ] },
  { tradeCode: 'CARP', tradeName: 'Carpenter', baseWageHourly: 42.75, isUnion: true, unionLocal: 'Carpenters 27', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.85,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.50 },
      { name: 'Pension', type: 'hourly', rate: 5.80 },
      { name: 'Training', type: 'hourly', rate: 0.85 },
      { name: 'Industry Fund', type: 'hourly', rate: 0.50 },
    ] },
  { tradeCode: 'IRON', tradeName: 'Ironworker (structural)', baseWageHourly: 46.50, isUnion: true, unionLocal: 'Ironworkers 721', wsibRateGroup: '764', wsibRate: 6.12, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 5.25 },
      { name: 'Pension', type: 'hourly', rate: 7.10 },
      { name: 'Training', type: 'hourly', rate: 0.90 },
      { name: 'Annuity', type: 'hourly', rate: 2.00 },
    ] },
  { tradeCode: 'ELEC', tradeName: 'Electrician', baseWageHourly: 48.25, isUnion: true, unionLocal: 'IBEW 353', wsibRateGroup: '707', wsibRate: 2.35, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.85 },
      { name: 'Pension', type: 'hourly', rate: 6.50 },
      { name: 'Training', type: 'hourly', rate: 1.10 },
      { name: 'Industry Fund', type: 'hourly', rate: 0.55 },
    ] },
  { tradeCode: 'PLMB', tradeName: 'Plumber', baseWageHourly: 47.00, isUnion: true, unionLocal: 'UA 46', wsibRateGroup: '707', wsibRate: 2.35, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.60 },
      { name: 'Pension', type: 'hourly', rate: 6.25 },
      { name: 'Training', type: 'hourly', rate: 1.00 },
      { name: 'Industry Fund', type: 'hourly', rate: 0.50 },
    ] },
  { tradeCode: 'SHMT', tradeName: 'Sheet Metal Worker', baseWageHourly: 46.00, isUnion: true, unionLocal: 'SMWIA 30', wsibRateGroup: '707', wsibRate: 2.35, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.50 },
      { name: 'Pension', type: 'hourly', rate: 5.90 },
      { name: 'Training', type: 'hourly', rate: 0.95 },
      { name: 'Industry Fund', type: 'hourly', rate: 0.50 },
    ] },
  { tradeCode: 'OPER', tradeName: 'Operating Engineer (crane)', baseWageHourly: 44.50, isUnion: true, unionLocal: 'IUOE 793', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.90,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.75 },
      { name: 'Pension', type: 'hourly', rate: 6.00 },
      { name: 'Training', type: 'hourly', rate: 0.85 },
    ] },
  { tradeCode: 'CONC', tradeName: 'Cement Finisher', baseWageHourly: 41.25, isUnion: true, unionLocal: 'LiUNA 183', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.85,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 3.75 },
      { name: 'Pension', type: 'hourly', rate: 4.25 },
      { name: 'Training', type: 'hourly', rate: 0.65 },
    ] },
  { tradeCode: 'PNTR', tradeName: 'Painter', baseWageHourly: 38.50, isUnion: true, unionLocal: 'Painters DC 46', wsibRateGroup: '764', wsibRate: 3.45, productivityFactor: 0.85,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 3.90 },
      { name: 'Pension', type: 'hourly', rate: 4.50 },
      { name: 'Training', type: 'hourly', rate: 0.60 },
    ] },
  { tradeCode: 'GLZR', tradeName: 'Glazier', baseWageHourly: 43.00, isUnion: true, unionLocal: 'Glaziers 1891', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.25 },
      { name: 'Pension', type: 'hourly', rate: 5.50 },
      { name: 'Training', type: 'hourly', rate: 0.80 },
    ] },
  { tradeCode: 'TILE', tradeName: 'Tile Setter', baseWageHourly: 40.50, isUnion: true, unionLocal: 'BAC 2', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.80,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.00 },
      { name: 'Pension', type: 'hourly', rate: 4.75 },
      { name: 'Training', type: 'hourly', rate: 0.70 },
    ] },
  { tradeCode: 'INSL', tradeName: 'Insulator', baseWageHourly: 42.00, isUnion: true, unionLocal: 'Insulators 95', wsibRateGroup: '764', wsibRate: 4.86, productivityFactor: 0.85,
    fringeBenefits: [
      { name: 'Health & Welfare', type: 'hourly', rate: 4.30 },
      { name: 'Pension', type: 'hourly', rate: 5.20 },
      { name: 'Training', type: 'hourly', rate: 0.75 },
    ] },
];

// ─── Core Calculation ────────────────────────────────────────────────────────

/**
 * Calculate fully loaded labor rate for a single trade.
 */
export function calculateLoadedRate(
  trade: TradeRate,
  statutory: StatutoryBurden[]
): LoadedLaborRate {
  const baseWage = trade.baseWageHourly;
  const breakdown: { item: string; amount: number }[] = [];

  // Statutory burdens (applied to base wage hourly)
  let statutoryTotal = 0;

  for (const burden of statutory) {
    if (burden.name === 'WSIB') {
      // WSIB uses trade-specific rate per $100 of assessable payroll
      const wsibHourly = baseWage * (trade.wsibRate / 100);
      statutoryTotal += wsibHourly;
      breakdown.push({ item: 'WSIB (' + trade.wsibRateGroup + ' @ ' + trade.wsibRate + '/$100)', amount: Math.round(wsibHourly * 100) / 100 });
    } else {
      const amount = baseWage * burden.rate;
      statutoryTotal += amount;
      breakdown.push({ item: burden.name + ' (' + (burden.rate * 100).toFixed(2) + '%)', amount: Math.round(amount * 100) / 100 });
    }
  }

  // Fringe benefits
  let fringeTotal = 0;
  for (const fringe of trade.fringeBenefits) {
    let amount = 0;
    if (fringe.type === 'hourly') {
      amount = fringe.rate;
    } else if (fringe.type === 'percent') {
      amount = baseWage * fringe.rate;
    } else if (fringe.type === 'monthly') {
      amount = fringe.rate / 173.33; // Monthly to hourly (2080 hrs/yr / 12)
    }
    fringeTotal += amount;
    breakdown.push({ item: fringe.name, amount: Math.round(amount * 100) / 100 });
  }

  const totalBurden = statutoryTotal + fringeTotal;
  const loadedRate = baseWage + totalBurden;
  const effectiveRate = trade.productivityFactor > 0 ? loadedRate / trade.productivityFactor : loadedRate;

  return {
    tradeCode: trade.tradeCode,
    tradeName: trade.tradeName,
    baseWage,
    statutoryBurden: Math.round(statutoryTotal * 100) / 100,
    fringeBurden: Math.round(fringeTotal * 100) / 100,
    totalBurden: Math.round(totalBurden * 100) / 100,
    burdenPercent: baseWage > 0 ? Math.round((totalBurden / baseWage) * 10000) / 100 : 0,
    loadedRate: Math.round(loadedRate * 100) / 100,
    effectiveRate: Math.round(effectiveRate * 100) / 100,
    breakdown,
  };
}

/**
 * Calculate blended crew rate from composition.
 */
export function calculateCrewRate(
  crew: CrewComposition,
  loadedRates: LoadedLaborRate[]
): CrewRate {
  const rateMap = new Map<string, LoadedLaborRate>();
  for (const r of loadedRates) rateMap.set(r.tradeCode, r);

  let totalDaily = 0;
  let totalMembers = 0;
  const memberBreakdown: CrewRate['memberBreakdown'] = [];

  for (const member of crew.members) {
    const rate = rateMap.get(member.tradeCode);
    if (!rate) continue;

    const dailyCost = rate.effectiveRate * member.hoursPerDay * member.count;
    totalDaily += dailyCost;
    totalMembers += member.count;

    memberBreakdown.push({
      tradeCode: member.tradeCode,
      tradeName: rate.tradeName,
      count: member.count,
      loadedRate: rate.effectiveRate,
      dailyCost: Math.round(dailyCost * 100) / 100,
    });
  }

  const equipmentCost = crew.equipmentCostPerDay || 0;

  return {
    crewId: crew.crewId,
    crewName: crew.crewName,
    totalMembersCount: totalMembers,
    dailyCost: Math.round((totalDaily + equipmentCost) * 100) / 100,
    hourlyCost: Math.round(((totalDaily + equipmentCost) / 8) * 100) / 100,
    laborOnlyCost: Math.round(totalDaily * 100) / 100,
    equipmentCost,
    memberBreakdown,
  };
}

/**
 * Generate full labor burden summary for all trades.
 */
export function generateLaborBurdenSummary(
  trades?: TradeRate[],
  statutory?: StatutoryBurden[],
  crews?: CrewComposition[]
): LaborBurdenSummary {
  const tradeList = trades || ONTARIO_2025_TRADES;
  const statList = statutory || ONTARIO_2025_STATUTORY;

  const totalStatPct = statList
    .filter(s => s.name !== 'WSIB')
    .reduce((sum, s) => sum + s.rate, 0);

  const loadedRates = tradeList.map(t => calculateLoadedRate(t, statList));
  const crewRates = (crews || []).map(c => calculateCrewRate(c, loadedRates));

  const avgBurden = loadedRates.length > 0
    ? loadedRates.reduce((s, r) => s + r.burdenPercent, 0) / loadedRates.length : 0;

  return {
    province: 'Ontario',
    year: 2025,
    statutoryBurdens: statList,
    totalStatutoryPercent: Math.round(totalStatPct * 10000) / 100,
    tradeRates: loadedRates,
    crewRates,
    averageBurdenPercent: Math.round(avgBurden * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format labor burden as human-readable report.
 */
export function formatLaborBurdenReport(summary: LaborBurdenSummary): string {
  const f = (n: number) => '$' + n.toFixed(2);
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  LABOR BURDEN ANALYSIS');
  out.push('  ' + summary.province + ' ' + summary.year);
  out.push('====================================================================');
  out.push('');
  out.push('  Statutory burden (ex WSIB): ' + summary.totalStatutoryPercent.toFixed(1) + '% of wages');
  out.push('  Average total burden: ' + summary.averageBurdenPercent.toFixed(1) + '% of base wage');
  out.push('  Trades analyzed: ' + summary.tradeRates.length);
  out.push('');

  out.push('  ── Loaded Rates by Trade ──');
  for (const r of summary.tradeRates) {
    out.push('  ' + r.tradeCode + ' ' + r.tradeName);
    out.push('    Base: ' + f(r.baseWage) + '/hr | Statutory: ' + f(r.statutoryBurden) +
      ' | Fringe: ' + f(r.fringeBurden) + ' | Loaded: ' + f(r.loadedRate) +
      ' | Effective: ' + f(r.effectiveRate) + '/hr (' + r.burdenPercent.toFixed(1) + '%)');
  }
  out.push('');

  if (summary.crewRates.length > 0) {
    out.push('  ── Crew Rates ──');
    for (const c of summary.crewRates) {
      out.push('  ' + c.crewName + ' (' + c.totalMembersCount + ' workers)');
      out.push('    Daily: ' + f(c.dailyCost) + ' | Hourly: ' + f(c.hourlyCost) +
        ' | Labor: ' + f(c.laborOnlyCost) + ' | Equipment: ' + f(c.equipmentCost));
    }
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}

/** Pre-populated Ontario 2025 statutory burdens */
export const STATUTORY_BURDENS_ON_2025 = ONTARIO_2025_STATUTORY;

/** Pre-populated Ontario 2025 trade rates */
export const TRADE_RATES_ON_2025 = ONTARIO_2025_TRADES;

// ─── Multi-Province Statutory Burden Support ────────────────────────────────
//
// Issue: WSIB and EHT are Ontario-specific. For multi-province projects,
// applying Ontario burden structure to other provinces produces incorrect
// loaded rates. CPP and EI are national (same rates), but workers' comp
// and provincial health taxes vary significantly.
//
// This section provides province-specific statutory overrides so
// generateLaborBurdenSummary() can produce correct loaded rates for any province.

export type CanadianProvince =
  | 'Ontario' | 'British Columbia' | 'Alberta' | 'Quebec'
  | 'Manitoba' | 'Saskatchewan' | 'Nova Scotia' | 'New Brunswick'
  | 'Newfoundland' | 'PEI';

export interface ProvincialBurdenOverride {
  province: CanadianProvince;
  /** Workers' compensation board name (varies by province) */
  wcbName: string;
  /** Default WCB rate per $100 assessable for construction (varies by trade) */
  wcbDefaultRate: number;
  /** Provincial employer health tax or equivalent (0 if none) */
  healthTaxRate: number;
  /** Health tax name (EHT in Ontario, none in most provinces) */
  healthTaxName: string;
  /** Provincial vacation pay minimum (ESA equivalent) */
  vacationPayRate: number;
  /** Number of provincial statutory holidays */
  statutoryHolidays: number;
  /** Notes on provincial differences */
  notes: string;
}

const PROVINCIAL_BURDEN_OVERRIDES: Record<CanadianProvince, ProvincialBurdenOverride> = {
  'Ontario': {
    province: 'Ontario', wcbName: 'WSIB', wcbDefaultRate: 4.86,
    healthTaxRate: 0.0195, healthTaxName: 'EHT',
    vacationPayRate: 0.04, statutoryHolidays: 9,
    notes: 'Baseline province. EHT applies to payroll >$1M.',
  },
  'British Columbia': {
    province: 'British Columbia', wcbName: 'WorkSafeBC', wcbDefaultRate: 3.44,
    healthTaxRate: 0.0195, healthTaxName: 'EHT (BC)',
    vacationPayRate: 0.04, statutoryHolidays: 10,
    notes: 'BC EHT applies to payroll >$500K. WorkSafeBC rates vary by CU code.',
  },
  'Alberta': {
    province: 'Alberta', wcbName: 'WCB Alberta', wcbDefaultRate: 3.18,
    healthTaxRate: 0.0, healthTaxName: 'None',
    vacationPayRate: 0.04, statutoryHolidays: 9,
    notes: 'No provincial health tax. WCB rates per industry code.',
  },
  'Quebec': {
    province: 'Quebec', wcbName: 'CNESST', wcbDefaultRate: 5.60,
    healthTaxRate: 0.0298, healthTaxName: 'HSF (Health Services Fund)',
    vacationPayRate: 0.06, statutoryHolidays: 8,
    notes: 'CNESST rates higher for construction. HSF 2.7-4.26% graduated. Vacation 6% CCQ requirement.',
  },
  'Manitoba': {
    province: 'Manitoba', wcbName: 'WCB Manitoba', wcbDefaultRate: 4.20,
    healthTaxRate: 0.0215, healthTaxName: 'HE Levy',
    vacationPayRate: 0.04, statutoryHolidays: 8,
    notes: 'Health & Education Levy on payroll >$2.25M.',
  },
  'Saskatchewan': {
    province: 'Saskatchewan', wcbName: 'WCB Saskatchewan', wcbDefaultRate: 3.15,
    healthTaxRate: 0.0, healthTaxName: 'None',
    vacationPayRate: 0.0375, statutoryHolidays: 10,
    notes: 'No provincial health tax. 3/52 weeks vacation = 5.77% after 1 year.',
  },
  'Nova Scotia': {
    province: 'Nova Scotia', wcbName: 'WCB Nova Scotia', wcbDefaultRate: 2.65,
    healthTaxRate: 0.0, healthTaxName: 'None',
    vacationPayRate: 0.04, statutoryHolidays: 6,
    notes: 'No provincial health tax. Fewer stat holidays than Ontario.',
  },
  'New Brunswick': {
    province: 'New Brunswick', wcbName: 'WorkSafeNB', wcbDefaultRate: 2.92,
    healthTaxRate: 0.0, healthTaxName: 'None',
    vacationPayRate: 0.04, statutoryHolidays: 8,
    notes: 'No provincial health tax.',
  },
  'Newfoundland': {
    province: 'Newfoundland', wcbName: 'WorkplaceNL', wcbDefaultRate: 3.85,
    healthTaxRate: 0.02, healthTaxName: 'HAPSET',
    vacationPayRate: 0.04, statutoryHolidays: 7,
    notes: 'Health and Post-Secondary Education Tax on payroll >$2M.',
  },
  'PEI': {
    province: 'PEI', wcbName: 'WCB PEI', wcbDefaultRate: 2.08,
    healthTaxRate: 0.0, healthTaxName: 'None',
    vacationPayRate: 0.04, statutoryHolidays: 7,
    notes: 'No provincial health tax. Lowest WCB rates in Canada.',
  },
};

/**
 * Get provincial statutory burdens adjusted for a specific province.
 * CPP and EI are national (unchanged). WSIB/WCB, health tax, vacation,
 * and stat holidays are province-specific.
 */
export function getProvincialStatutoryBurdens(province: CanadianProvince): StatutoryBurden[] {
  const override = PROVINCIAL_BURDEN_OVERRIDES[province];
  if (!override) return ONTARIO_2025_STATUTORY; // fallback

  const statHolidayRate = override.statutoryHolidays / 250; // working days

  return [
    // National: CPP (same across all provinces)
    {
      name: 'CPP2',
      description: 'Canada Pension Plan (employer share)',
      rate: 0.0595,
      basis: 'gross-wages',
      annualMaximum: 4055.50,
      employerOnly: false,
      notes: 'National rate — same in all provinces',
    },
    // National: EI (same across all provinces, except Quebec which has QPIP)
    {
      name: 'EI',
      description: 'Employment Insurance (employer share)',
      rate: province === 'Quebec' ? 0.01960 : 0.02282, // Quebec EI reduced due to QPIP
      basis: 'insurable-earnings',
      annualMaximum: province === 'Quebec' ? 905.76 : 1049.12,
      employerOnly: false,
      notes: province === 'Quebec'
        ? 'Quebec reduced EI rate (QPIP covers parental leave)'
        : 'Employer pays 1.4x employee rate',
    },
    // Provincial: Workers' Compensation
    {
      name: override.wcbName,
      description: override.wcbName + ' (' + province + ')',
      rate: 0.0, // Applied per trade via wsibRate field (overridden below)
      basis: 'assessable-payroll',
      employerOnly: true,
      notes: 'Rate varies by trade — default construction rate: $' +
        override.wcbDefaultRate.toFixed(2) + '/$100. ' + override.notes,
    },
    // Provincial: Health Tax (if applicable)
    ...(override.healthTaxRate > 0 ? [{
      name: override.healthTaxName,
      description: override.healthTaxName + ' (' + province + ')',
      rate: override.healthTaxRate,
      basis: 'gross-wages' as const,
      employerOnly: true,
      notes: province + ' employer health tax',
    }] : []),
    // Provincial: Vacation Pay
    {
      name: 'Vacation Pay',
      description: 'Vacation pay (' + province + ' minimum)',
      rate: override.vacationPayRate,
      basis: 'gross-wages',
      employerOnly: true,
      notes: province + ' minimum ' + (override.vacationPayRate * 100).toFixed(1) + '%',
    },
    // Provincial: Statutory Holidays
    {
      name: 'Public Holidays',
      description: province + ' statutory holidays (' + override.statutoryHolidays + ' days)',
      rate: Math.round(statHolidayRate * 10000) / 10000,
      basis: 'gross-wages',
      employerOnly: true,
      notes: override.statutoryHolidays + ' public holidays / 250 working days',
    },
    // Quebec-specific: QPIP (Quebec Parental Insurance Plan)
    ...(province === 'Quebec' ? [{
      name: 'QPIP',
      description: 'Quebec Parental Insurance Plan (employer)',
      rate: 0.00692,
      basis: 'gross-wages' as const,
      employerOnly: false,
      notes: 'Quebec only — replaces federal parental EI benefits',
    }] : []),
  ];
}

/**
 * Generate labor burden summary for a specific province.
 * Adjusts trade WCB rates using the provincial default as a proxy.
 */
export function generateProvincialLaborBurdenSummary(
  province: CanadianProvince,
  trades?: TradeRate[],
  crews?: CrewComposition[]
): LaborBurdenSummary {
  const override = PROVINCIAL_BURDEN_OVERRIDES[province];
  const statutory = getProvincialStatutoryBurdens(province);

  // Adjust trade WCB rates proportionally for the target province
  const tradeList = (trades || ONTARIO_2025_TRADES).map(t => ({
    ...t,
    // Scale WSIB rate by ratio of provincial default to Ontario default
    wsibRate: override
      ? t.wsibRate * (override.wcbDefaultRate / PROVINCIAL_BURDEN_OVERRIDES['Ontario'].wcbDefaultRate)
      : t.wsibRate,
    wsibRateGroup: override ? override.wcbName + ':' + t.wsibRateGroup : t.wsibRateGroup,
  }));

  const totalStatPct = statutory
    .filter(s => s.name !== override?.wcbName && s.name !== 'WSIB')
    .reduce((sum, s) => sum + s.rate, 0);

  const loadedRates = tradeList.map(t => calculateLoadedRate(t, statutory));
  const crewRates = (crews || []).map(c => calculateCrewRate(c, loadedRates));

  const avgBurden = loadedRates.length > 0
    ? loadedRates.reduce((s, r) => s + r.burdenPercent, 0) / loadedRates.length : 0;

  return {
    province,
    year: 2025,
    statutoryBurdens: statutory,
    totalStatutoryPercent: Math.round(totalStatPct * 10000) / 100,
    tradeRates: loadedRates,
    crewRates,
    averageBurdenPercent: Math.round(avgBurden * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}

/** Available provincial burden overrides */
export const PROVINCIAL_OVERRIDES = PROVINCIAL_BURDEN_OVERRIDES;
