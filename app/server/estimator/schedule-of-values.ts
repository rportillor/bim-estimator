// server/estimator/schedule-of-values.ts
// =============================================================================
// SCHEDULE OF VALUES GENERATOR
// =============================================================================
//
// Closes QS Level 5 gaps:
//   6.4  Schedule of Values Generator
//   8.4  Schedule of Values Generator (same item, referenced in both phases)
//
// Generates trade-by-trade breakdown suitable for:
//   - Contractor progress billing (CCDC 2 format)
//   - Owner draw requests
//   - CCDC 5 / CCA cost breakdown
//
// Output: JSON, CSV (exportable to XLSX via external tool)
//
// Consumes: EstimateSummary from estimate-engine.ts, BudgetStructure from budget-structure.ts
// Consumed by: qs-level5-routes.ts, boe-generator.ts
// =============================================================================

import type { EstimateSummary } from './estimate-engine';


// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface SOVLineItem {
  itemNumber: string;          // Sequential: "001", "002", etc.
  csiDivision: string;
  csiDivisionName: string;
  description: string;
  scheduledValue: number;      // $
  materialValue: number;
  laborValue: number;
  equipmentValue: number;
  percentOfTotal: number;      // % of grand total
  lineItemCount: number;       // number of estimate line items rolled up
  retainagePercent: number;    // holdback (typically 10% per CCDC)
  retainageAmount: number;
}

export interface SOVSummary {
  items: SOVLineItem[];
  subtotalScheduledValue: number;
  totalRetainage: number;
  netPayable: number;          // subtotal - retainage
  grandTotal: number;          // from estimate
  divisionCount: number;
  generatedAt: string;
  projectName?: string;
  contractNumber?: string;
  methodology: 'CIQS';
  currency: 'CAD';
}

export interface SOVProgressEntry {
  itemNumber: string;
  description: string;
  scheduledValue: number;
  previousCompleted: number;
  currentCompleted: number;
  totalCompleted: number;
  percentComplete: number;
  balanceToFinish: number;
  retainageHeld: number;
}

export interface SOVProgressCertificate {
  certificateNumber: string;
  periodEnding: string;         // ISO date
  items: SOVProgressEntry[];
  totalScheduledValue: number;
  totalPreviousCompleted: number;
  totalCurrentCompleted: number;
  totalCompleted: number;
  totalRetainageHeld: number;
  netPayableThisPeriod: number;
  generatedAt: string;
}


// ─── GENERATE SOV FROM ESTIMATE ─────────────────────────────────────────────

export function generateScheduleOfValues(
  estimate: EstimateSummary,
  options?: {
    retainagePercent?: number;  // default 10% per CCDC 2
    projectName?: string;
    contractNumber?: string;
    includeMarkups?: boolean;
    markupPercent?: number;     // OH&P to distribute across divisions
  },
): SOVSummary {
  const retPct = options?.retainagePercent ?? 10;
  const markupMult = options?.includeMarkups && options.markupPercent
    ? 1 + options.markupPercent / 100
    : 1;

  // Group all line items by CSI division
  const divGroups = new Map<string, {
    name: string; mat: number; lab: number; eqp: number; count: number;
  }>();

  for (const floor of estimate.floors) {
    for (const li of floor.lineItems) {
      const existing = divGroups.get(li.csiDivision) ?? { name: li.csiDivisionName, mat: 0, lab: 0, eqp: 0, count: 0 };
      existing.mat += li.materialCost;
      existing.lab += li.laborCost;
      existing.eqp += li.equipmentCost;
      existing.count += 1;
      divGroups.set(li.csiDivision, existing);
    }
  }

  // Build SOV items sorted by division
  const sortedDivs = [...divGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let itemNum = 1;

  const items: SOVLineItem[] = sortedDivs.map(([div, g]) => {
    const rawTotal = (g.mat + g.lab + g.eqp) * markupMult;
    const scheduled = Math.round(rawTotal * 100) / 100;
    const retAmount = Math.round(scheduled * retPct / 100 * 100) / 100;
    const num = String(itemNum++).padStart(3, '0');

    return {
      itemNumber: num,
      csiDivision: div,
      csiDivisionName: g.name,
      description: `Div ${div} — ${g.name}`,
      scheduledValue: scheduled,
      materialValue: Math.round(g.mat * markupMult * 100) / 100,
      laborValue: Math.round(g.lab * markupMult * 100) / 100,
      equipmentValue: Math.round(g.eqp * markupMult * 100) / 100,
      percentOfTotal: 0,  // computed below
      lineItemCount: g.count,
      retainagePercent: retPct,
      retainageAmount: retAmount,
    };
  });

  const subtotal = items.reduce((s, i) => s + i.scheduledValue, 0);

  // Compute percentages
  for (const item of items) {
    item.percentOfTotal = subtotal > 0
      ? Math.round((item.scheduledValue / subtotal) * 10000) / 100
      : 0;
  }

  const totalRetainage = items.reduce((s, i) => s + i.retainageAmount, 0);

  return {
    items,
    subtotalScheduledValue: Math.round(subtotal * 100) / 100,
    totalRetainage: Math.round(totalRetainage * 100) / 100,
    netPayable: Math.round((subtotal - totalRetainage) * 100) / 100,
    grandTotal: Math.round(estimate.grandTotal * 100) / 100,
    divisionCount: items.length,
    generatedAt: new Date().toISOString(),
    projectName: options?.projectName,
    contractNumber: options?.contractNumber,
    methodology: 'CIQS',
    currency: 'CAD',
  };
}


// ─── GENERATE PROGRESS CERTIFICATE ─────────────────────────────────────────

export function generateProgressCertificate(
  sov: SOVSummary,
  certificateNumber: string,
  periodEnding: string,
  completionPercentages: Record<string, number>, // itemNumber → % complete (0-100)
  previousCertificate?: SOVProgressCertificate,
): SOVProgressCertificate {
  const items: SOVProgressEntry[] = sov.items.map(sovItem => {
    const pctComplete = Math.min(100, Math.max(0, completionPercentages[sovItem.itemNumber] ?? 0));
    const totalCompleted = Math.round(sovItem.scheduledValue * pctComplete / 100 * 100) / 100;

    // Find previous completed from prior certificate
    const prevItem = previousCertificate?.items.find(pi => pi.itemNumber === sovItem.itemNumber);
    const previousCompleted = prevItem?.totalCompleted ?? 0;
    const currentCompleted = Math.round((totalCompleted - previousCompleted) * 100) / 100;

    return {
      itemNumber: sovItem.itemNumber,
      description: sovItem.description,
      scheduledValue: sovItem.scheduledValue,
      previousCompleted: Math.round(previousCompleted * 100) / 100,
      currentCompleted: Math.max(0, currentCompleted),
      totalCompleted,
      percentComplete: pctComplete,
      balanceToFinish: Math.round((sovItem.scheduledValue - totalCompleted) * 100) / 100,
      retainageHeld: Math.round(totalCompleted * sovItem.retainagePercent / 100 * 100) / 100,
    };
  });

  const totalScheduled = items.reduce((s, i) => s + i.scheduledValue, 0);
  const totalPrevious = items.reduce((s, i) => s + i.previousCompleted, 0);
  const totalCurrent = items.reduce((s, i) => s + i.currentCompleted, 0);
  const totalComp = items.reduce((s, i) => s + i.totalCompleted, 0);
  const totalRet = items.reduce((s, i) => s + i.retainageHeld, 0);

  // Net payable = current work completed - retainage increase
  const prevRetainage = previousCertificate?.totalRetainageHeld ?? 0;
  const retainageIncrease = totalRet - prevRetainage;

  return {
    certificateNumber,
    periodEnding,
    items,
    totalScheduledValue: Math.round(totalScheduled * 100) / 100,
    totalPreviousCompleted: Math.round(totalPrevious * 100) / 100,
    totalCurrentCompleted: Math.round(totalCurrent * 100) / 100,
    totalCompleted: Math.round(totalComp * 100) / 100,
    totalRetainageHeld: Math.round(totalRet * 100) / 100,
    netPayableThisPeriod: Math.round((totalCurrent - retainageIncrease) * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}


// ─── CSV EXPORT ─────────────────────────────────────────────────────────────

export function sovToCSV(sov: SOVSummary): string {
  const header = 'Item #,CSI Division,Description,Material,Labor,Equipment,Scheduled Value,% of Total,Retainage';
  const rows = sov.items.map(i =>
    `${i.itemNumber},${i.csiDivision},"${i.description}",${i.materialValue},${i.laborValue},${i.equipmentValue},${i.scheduledValue},${i.percentOfTotal}%,${i.retainageAmount}`
  );
  const footer = `,,TOTAL,,,,$${sov.subtotalScheduledValue.toFixed(2)},100%,$${sov.totalRetainage.toFixed(2)}`;
  return [header, ...rows, footer].join('\n');
}

export function progressCertificateToCSV(cert: SOVProgressCertificate): string {
  const header = 'Item #,Description,Scheduled Value,Previous,Current,Total Completed,% Complete,Balance,Retainage';
  const rows = cert.items.map(i =>
    `${i.itemNumber},"${i.description}",${i.scheduledValue},${i.previousCompleted},${i.currentCompleted},${i.totalCompleted},${i.percentComplete}%,${i.balanceToFinish},${i.retainageHeld}`
  );
  const footer = `,TOTALS,${cert.totalScheduledValue},${cert.totalPreviousCompleted},${cert.totalCurrentCompleted},${cert.totalCompleted},,,$${cert.totalRetainageHeld.toFixed(2)}`;
  const netLine = `,,,,,,,,Net Payable: $${cert.netPayableThisPeriod.toFixed(2)}`;
  return [header, ...rows, footer, netLine].join('\n');
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const sovStore = new Map<string, SOVSummary>();
const certStore = new Map<string, SOVProgressCertificate[]>();

export function storeSOV(projectId: string, sov: SOVSummary): SOVSummary {
  sovStore.set(projectId, sov);
  return sov;
}
export function getSOV(projectId: string): SOVSummary | undefined {
  return sovStore.get(projectId);
}
export function storeCertificate(projectId: string, cert: SOVProgressCertificate): SOVProgressCertificate {
  const existing = certStore.get(projectId) ?? [];
  existing.push(cert);
  certStore.set(projectId, existing);
  return cert;
}
export function getCertificates(projectId: string): SOVProgressCertificate[] {
  return certStore.get(projectId) ?? [];
}

// ── SOVConfig & formatSOVReport — referenced by estimator-router ──────────
export interface SOVConfig {
  projectName?: string;
  retainagePercent?: number;
  detailLevel?: 'summary' | 'division' | 'subdivision';
  includeGeneralConditions?: boolean;
  includeOverheadProfit?: boolean;
  contractNumber?: string;
}

export function formatSOVReport(sov: SOVSummary): string {
  const lines: string[] = [
    `SCHEDULE OF VALUES — ${sov.projectName || 'Project'}`,
    `Contract: ${sov.contractNumber || 'N/A'}  |  Retainage: ${sov.totalRetainage ? ((sov.totalRetainage / sov.subtotalScheduledValue) * 100).toFixed(0) : 10}%`,
    `Total Contract Value: ${sov.grandTotal.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}`,
    '',
    'DIVISION BREAKDOWN',
    '-'.repeat(80),
  ];
  for (const item of sov.items) {
    lines.push(
      `${item.csiDivision.padEnd(8)} ${item.description.padEnd(40)} ` +
      `${item.scheduledValue.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }).padStart(14)}`
    );
  }
  lines.push('-'.repeat(80));
  return lines.join('\n');
}
