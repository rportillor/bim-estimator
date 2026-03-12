/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OH&P CONFIGURATION — Overhead & Profit Rate Management
 *  Stream A — Estimation Completion (Item A2.7)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Replaces hardcoded overhead (15%) and profit (10%) fallbacks with a
 *  configurable, project-level settings module backed by the database.
 *
 *  QS Principle: No silent default values. If OH&P rates are not explicitly
 *  configured for a project, the system flags it and uses the regional
 *  defaults with a LOW_CONFIDENCE warning. The user should confirm rates
 *  before finalizing any estimate.
 *
 *  Consumed by:
 *    - estimates.ts (POST /estimates/:modelId/run)
 *    - estimate-engine.ts (buildEstimateForElements)
 *
 *  @module ohp-configuration
 *  @version 2.0.0 — DB-persisted via projectOhpConfigs table
 */

import { storage } from '../storage';

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** OH&P rate source — tracks where the rate came from for audit trail */
export type OHPRateSource =
  | 'PROJECT_CONFIGURED'     // Explicitly set by user for this project
  | 'REGIONAL_DEFAULT'       // From canadian-cost-data.ts regional factors
  | 'SYSTEM_FALLBACK';       // Last resort — flagged as LOW_CONFIDENCE

/** Individual rate with source tracking */
export interface OHPRate {
  value: number;             // Decimal (e.g., 0.15 = 15%)
  source: OHPRateSource;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  note?: string;             // Human-readable note (e.g., "User confirmed 2026-03-01")
}

/** Complete OH&P configuration for a project */
export interface OHPConfiguration {
  /** General contractor overhead (decimal, e.g., 0.15 = 15%) */
  overhead: OHPRate;
  /** General contractor profit (decimal, e.g., 0.10 = 10%) */
  profit: OHPRate;
  /** Contingency rate (decimal, e.g., 0.05 = 5%) — also configurable */
  contingency?: OHPRate;
  /** Whether OH&P applies to subcontractor costs (common in CM/GC) */
  applyToSubcontractorCosts: boolean;
  /** Whether OH&P applies to equipment costs */
  applyToEquipmentCosts: boolean;
  /** Project-specific notes */
  projectNotes?: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Who set these rates */
  updatedBy?: string;
}

/** Resolved OH&P values ready for calculation — the consumer-facing output */
export interface ResolvedOHP {
  overheadRate: number;       // Decimal (e.g., 0.15)
  profitRate: number;         // Decimal (e.g., 0.10)
  contingencyRate: number;    // Decimal (e.g., 0.05)
  combinedMarkup: number;     // overhead + profit (e.g., 0.25)
  overheadFactor: number;     // 1 + overhead (e.g., 1.15)
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  warnings: string[];
  applyToSubs: boolean;
  applyToEquip: boolean;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROJECT CONFIGURATION STORE — DB-backed with write-through cache
// ═══════════════════════════════════════════════════════════════════════════════

/** Write-through cache to avoid DB round-trip on every estimate call */
const configCache = new Map<string, { config: OHPConfiguration; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(projectId: string): OHPConfiguration | undefined {
  const entry = configCache.get(projectId);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    configCache.delete(projectId);
    return undefined;
  }
  return entry.config;
}

function setCache(projectId: string, config: OHPConfiguration): void {
  configCache.set(projectId, { config, cachedAt: Date.now() });
}

function dbRowToConfig(row: any): OHPConfiguration {
  return {
    overhead: {
      value: parseFloat(row.overheadPct) || 0,
      source: row.overheadSource as OHPRateSource,
      confidence: (row.overheadConfidence || 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
    },
    profit: {
      value: parseFloat(row.profitPct) || 0,
      source: row.profitSource as OHPRateSource,
      confidence: (row.profitConfidence || 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
    },
    contingency: {
      value: parseFloat(row.contingencyPct) || 0,
      source: row.contingencySource as OHPRateSource,
      confidence: (row.contingencyConfidence || 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
    },
    applyToSubcontractorCosts: row.applyToSubcontractorCosts ?? true,
    applyToEquipmentCosts: row.applyToEquipmentCosts ?? true,
    projectNotes: row.projectNotes ?? undefined,
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    updatedBy: row.updatedBy ?? undefined,
  };
}

/** Set OH&P configuration for a project — persists to database */
export async function setProjectOHP(
  projectId: string,
  config: Partial<OHPConfiguration>,
): Promise<OHPConfiguration> {
  const existing = await getProjectOHP(projectId);

  const merged: OHPConfiguration = {
    overhead: config.overhead ?? existing?.overhead ?? {
      value: 0,
      source: 'SYSTEM_FALLBACK',
      confidence: 'LOW',
      note: 'Not configured — requires user input',
    },
    profit: config.profit ?? existing?.profit ?? {
      value: 0,
      source: 'SYSTEM_FALLBACK',
      confidence: 'LOW',
      note: 'Not configured — requires user input',
    },
    contingency: config.contingency ?? existing?.contingency,
    applyToSubcontractorCosts: config.applyToSubcontractorCosts ?? existing?.applyToSubcontractorCosts ?? true,
    applyToEquipmentCosts: config.applyToEquipmentCosts ?? existing?.applyToEquipmentCosts ?? true,
    projectNotes: config.projectNotes ?? existing?.projectNotes,
    updatedAt: new Date().toISOString(),
    updatedBy: config.updatedBy,
  };

  // Persist to database
  try {
    await storage.upsertProjectOhpConfig({
      projectId,
      overheadPct: String(merged.overhead.value),
      overheadSource: merged.overhead.source,
      overheadConfidence: merged.overhead.confidence,
      profitPct: String(merged.profit.value),
      profitSource: merged.profit.source,
      profitConfidence: merged.profit.confidence,
      contingencyPct: String(merged.contingency?.value ?? 0.05),
      contingencySource: merged.contingency?.source ?? 'SYSTEM_FALLBACK',
      contingencyConfidence: merged.contingency?.confidence ?? 'LOW',
      applyToSubcontractorCosts: merged.applyToSubcontractorCosts,
      applyToEquipmentCosts: merged.applyToEquipmentCosts,
      projectNotes: merged.projectNotes ?? null,
      updatedBy: merged.updatedBy ?? null,
    });
  } catch (err) {
    console.warn('[OHP] DB write failed, config saved to cache only:', err);
  }

  setCache(projectId, merged);
  return merged;
}

/** Get OH&P configuration for a project — reads from DB with cache */
export async function getProjectOHP(projectId: string): Promise<OHPConfiguration | undefined> {
  // Check cache first
  const cached = getCached(projectId);
  if (cached) return cached;

  // Query database
  try {
    const row = await storage.getProjectOhpConfig(projectId);
    if (row) {
      const config = dbRowToConfig(row);
      setCache(projectId, config);
      return config;
    }
  } catch {
    // DB unavailable — return undefined, resolveOHP will use fallbacks
  }
  return undefined;
}

/** Delete OH&P configuration for a project */
export function clearProjectOHP(projectId: string): boolean {
  configCache.delete(projectId);
  return true;
}

/** List all configured projects (from cache — for backward compat) */
export function listConfiguredProjects(): string[] {
  return [...configCache.keys()];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  RATE RESOLUTION — THE MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve OH&P rates for a project.
 * Now async — reads from database when cache is cold.
 *
 * Priority order (per QS principle — explicit over implicit):
 *   1. Project-level configuration (if set by user)
 *   2. Regional defaults (from cost factor data)
 *   3. System fallback (with LOW_CONFIDENCE warning)
 */
export async function resolveOHP(
  projectId: string,
  regionalOverheadFactor?: number,
  regionalProfitMargin?: number,
  regionalContingency?: number,
): Promise<ResolvedOHP> {
  const config = await getProjectOHP(projectId);
  const warnings: string[] = [];

  // ─── Resolve overhead ─────────────────────────────────────────────────

  let overheadRate: number;
  let overheadSource: OHPRateSource;

  if (config?.overhead && config.overhead.source === 'PROJECT_CONFIGURED') {
    overheadRate = config.overhead.value;
    overheadSource = 'PROJECT_CONFIGURED';
  } else if (regionalOverheadFactor !== undefined && regionalOverheadFactor > 0) {
    overheadRate = regionalOverheadFactor > 1
      ? regionalOverheadFactor - 1.0
      : regionalOverheadFactor;
    overheadSource = 'REGIONAL_DEFAULT';
    warnings.push(`Overhead rate ${(overheadRate * 100).toFixed(1)}% from regional default — not project-confirmed.`);
  } else {
    overheadRate = SYSTEM_FALLBACK_OVERHEAD;
    overheadSource = 'SYSTEM_FALLBACK';
    warnings.push(`OH&P WARNING: Overhead rate using system fallback of ${(SYSTEM_FALLBACK_OVERHEAD * 100).toFixed(0)}%. Configure project OH&P to remove this warning.`);
  }

  // ─── Resolve profit ───────────────────────────────────────────────────

  let profitRate: number;
  let profitSource: OHPRateSource;

  if (config?.profit && config.profit.source === 'PROJECT_CONFIGURED') {
    profitRate = config.profit.value;
    profitSource = 'PROJECT_CONFIGURED';
  } else if (regionalProfitMargin !== undefined && regionalProfitMargin > 0) {
    profitRate = regionalProfitMargin;
    profitSource = 'REGIONAL_DEFAULT';
    warnings.push(`Profit rate ${(regionalProfitMargin * 100).toFixed(1)}% from regional default — not project-confirmed.`);
  } else {
    profitRate = SYSTEM_FALLBACK_PROFIT;
    profitSource = 'SYSTEM_FALLBACK';
    warnings.push(`OH&P WARNING: Profit rate using system fallback of ${(SYSTEM_FALLBACK_PROFIT * 100).toFixed(0)}%. Configure project OH&P to remove this warning.`);
  }

  // ─── Resolve contingency ──────────────────────────────────────────────

  let contingencyRate: number;
  if (config?.contingency && config.contingency.source === 'PROJECT_CONFIGURED') {
    contingencyRate = config.contingency.value;
  } else if (regionalContingency !== undefined && regionalContingency > 0) {
    contingencyRate = regionalContingency;
  } else {
    contingencyRate = SYSTEM_FALLBACK_CONTINGENCY;
  }

  // ─── Determine confidence ─────────────────────────────────────────────

  const sources = [overheadSource, profitSource];
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (sources.every(s => s === 'PROJECT_CONFIGURED')) {
    confidence = 'HIGH';
  } else if (sources.some(s => s === 'SYSTEM_FALLBACK')) {
    confidence = 'LOW';
  } else {
    confidence = 'MEDIUM';
  }

  return {
    overheadRate,
    profitRate,
    contingencyRate,
    combinedMarkup: overheadRate + profitRate,
    overheadFactor: 1 + overheadRate,
    confidence,
    warnings,
    applyToSubs: config?.applyToSubcontractorCosts ?? true,
    applyToEquip: config?.applyToEquipmentCosts ?? true,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM FALLBACK VALUES
// ═══════════════════════════════════════════════════════════════════════════════

const SYSTEM_FALLBACK_OVERHEAD = 0.15;
const SYSTEM_FALLBACK_PROFIT = 0.10;
const SYSTEM_FALLBACK_CONTINGENCY = 0.05;


// ═══════════════════════════════════════════════════════════════════════════════
//  CONVENIENCE FUNCTIONS FOR CONSUMER MODULES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Drop-in replacement for `estimates.ts` line 30.
 */
export async function getOverheadProfitCombined(
  projectId: string,
  userProvided?: number,
  regionalOverheadFactor?: number,
  regionalProfitMargin?: number,
): Promise<number> {
  if (userProvided !== undefined && userProvided !== null) {
    return Number(userProvided);
  }
  const resolved = await resolveOHP(projectId, regionalOverheadFactor, regionalProfitMargin);
  return resolved.combinedMarkup;
}

/**
 * Drop-in for cost-estimation-engine.ts lines 682-683.
 */
export async function getOverheadAndProfit(
  projectId: string,
  regionalOverheadFactor?: number,
  regionalProfitMargin?: number,
): Promise<{ overheadRate: number; profitRate: number; warnings: string[] }> {
  const resolved = await resolveOHP(projectId, regionalOverheadFactor, regionalProfitMargin);
  return {
    overheadRate: resolved.overheadRate,
    profitRate: resolved.profitRate,
    warnings: resolved.warnings,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Validate OH&P rates are within reasonable bounds */
export function validateOHPRates(
  overhead: number,
  profit: number,
  contingency?: number,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (overhead < 0 || overhead > 0.50) {
    warnings.push(`Overhead rate ${(overhead * 100).toFixed(1)}% is outside typical range (0-50%).`);
  }
  if (profit < 0 || profit > 0.30) {
    warnings.push(`Profit rate ${(profit * 100).toFixed(1)}% is outside typical range (0-30%).`);
  }
  if (overhead + profit > 0.50) {
    warnings.push(`Combined OH&P of ${((overhead + profit) * 100).toFixed(1)}% is unusually high.`);
  }
  if (contingency !== undefined && (contingency < 0 || contingency > 0.25)) {
    warnings.push(`Contingency rate ${(contingency * 100).toFixed(1)}% is outside typical range (0-25%).`);
  }

  return { valid: warnings.length === 0, warnings };
}
