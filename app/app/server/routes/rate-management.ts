/**
 * Rate Management Router — CRUD for DB-backed estimation rate tables
 *
 * Features:
 *   - Auth: All routes require authenticateToken; write ops require admin role
 *   - Audit: Every mutation logs to rate_audit_log with user + field changes
 *   - Versioning: Each update snapshots the previous version to rate_versions
 *   - CSV: GET …/export?format=csv and POST …/import for bulk operations
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';

export const rateManagementRouter = Router();

// ── Middleware ───────────────────────────────────────────────────────────────

/** Require admin role for write operations */
const requireAdmin = (req: Request, res: Response, next: Function): void => {
  if (req.user?.role === 'admin') return next();
  // Allow service-to-service via ADMIN_API_KEY header
  const adminApiKey = process.env.ADMIN_API_KEY;
  if (adminApiKey && req.headers['x-admin-token'] === adminApiKey) return next();
  res.status(403).json({ ok: false, error: 'Admin access required to modify rates' });
};

// ── Audit helper ────────────────────────────────────────────────────────────

function diffFields(oldObj: any, newObj: any): Record<string, { old: any; new: any }> | null {
  const changes: Record<string, { old: any; new: any }> = {};
  for (const key of Object.keys(newObj)) {
    if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;
    const ov = oldObj?.[key];
    const nv = newObj[key];
    if (String(ov) !== String(nv)) {
      changes[key] = { old: ov ?? null, new: nv };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

async function auditAndVersion(
  req: Request,
  tableName: string,
  recordId: string,
  action: string,
  oldSnapshot: any | null,
  newSnapshot: any,
) {
  const fieldChanges = action === 'create' ? null : diffFields(oldSnapshot, newSnapshot);

  await storage.createRateAuditEntry({
    tableName,
    recordId,
    action,
    userId: req.user?.id ?? null,
    userName: req.user?.name ?? req.user?.username ?? null,
    fieldChanges,
    metadata: null,
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? null,
  });

  // Version the previous state (before this change)
  if (oldSnapshot) {
    const latest = await storage.getLatestRateVersion(tableName, recordId);
    const nextVersion = (latest?.version ?? 0) + 1;
    await storage.createRateVersion({
      tableName,
      recordId,
      version: nextVersion,
      snapshot: oldSnapshot,
      changedBy: req.user?.id ?? null,
      changedByName: req.user?.name ?? req.user?.username ?? null,
      changeReason: (req.body as any)?.changeReason ?? null,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG ENDPOINT
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/rates/audit — View rate change audit log */
rateManagementRouter.get('/audit', async (req, res) => {
  try {
    const { table: tableName, recordId, limit } = req.query;
    const entries = await storage.getRateAuditLog(
      tableName as string | undefined,
      recordId as string | undefined,
      limit ? parseInt(limit as string, 10) : 100,
    );
    res.json({ ok: true, count: entries.length, entries });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/versions/:tableName/:recordId — View version history for a rate */
rateManagementRouter.get('/versions/:tableName/:recordId', async (req, res) => {
  try {
    const versions = await storage.getRateVersions(req.params.tableName, req.params.recordId);
    res.json({ ok: true, count: versions.length, versions });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIT RATES (CSI MasterFormat)
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/rates/unit — List all unit rates (filterable by division, region, source) */
rateManagementRouter.get('/unit', async (req, res) => {
  try {
    const { division, region, source } = req.query;
    const rates = await storage.getUnitRates({
      division: division as string,
      region: region as string,
      source: source as string,
    });
    res.json({ ok: true, count: rates.length, rates });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/unit/export — Export unit rates as CSV */
rateManagementRouter.get('/unit/export', async (req, res) => {
  try {
    const rates = await storage.getUnitRates();
    const header = 'csiCode,description,unit,materialRate,laborRate,equipmentRate,crewSize,productivityRate,source,region';
    const rows = rates.map(r =>
      [r.csiCode, `"${(r.description ?? '').replace(/"/g, '""')}"`, r.unit, r.materialRate, r.laborRate, r.equipmentRate, r.crewSize, r.productivityRate, r.source, r.region ?? ''].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="unit-rates.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/rates/unit/import — Import unit rates from CSV body */
rateManagementRouter.post('/unit/import', requireAdmin, async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ ok: false, error: 'csv string is required in request body' });
    }

    const lines = csv.trim().split('\n');
    const headerLine = lines[0];
    if (!headerLine?.toLowerCase().includes('csicode')) {
      return res.status(400).json({ ok: false, error: 'CSV must have a header row with csiCode column' });
    }

    const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
    let imported = 0;
    let errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = vals[idx]?.trim() ?? ''; });

      if (!row.csicode || !row.description || !row.unit) {
        errors.push(`Row ${i + 1}: missing required fields (csiCode, description, unit)`);
        continue;
      }

      const existing = await storage.getUnitRate(row.csicode, row.region || null);

      const rate = await storage.upsertUnitRate({
        csiCode: row.csicode,
        description: row.description,
        unit: row.unit,
        materialRate: row.materialrate || '0',
        laborRate: row.laborrate || '0',
        equipmentRate: row.equipmentrate || '0',
        crewSize: row.crewsize || '1',
        productivityRate: row.productivityrate || '1',
        source: 'user_override',
        region: row.region || null,
      });

      await auditAndVersion(req, 'unit_rates', rate.id, existing ? 'update' : 'import', existing ?? null, rate);
      imported++;
    }

    res.json({ ok: true, imported, total: lines.length - 1, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/unit/:csiCode — Get a single unit rate */
rateManagementRouter.get('/unit/:csiCode', async (req, res) => {
  try {
    const { csiCode } = req.params;
    const region = req.query.region as string | undefined;
    const rate = await storage.getUnitRate(csiCode, region);
    if (!rate) {
      return res.status(404).json({ ok: false, error: `No rate found for ${csiCode}` });
    }
    res.json({ ok: true, rate });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/rates/unit/:csiCode — Update or create a unit rate (admin only) */
rateManagementRouter.put('/unit/:csiCode', requireAdmin, async (req, res) => {
  try {
    const { csiCode } = req.params;
    const { description, unit, materialRate, laborRate, equipmentRate, crewSize, productivityRate, region } = req.body;

    if (!description || !unit) {
      return res.status(400).json({ ok: false, error: 'description and unit are required' });
    }

    const existing = await storage.getUnitRate(csiCode, region);

    const rate = await storage.upsertUnitRate({
      csiCode,
      description,
      unit,
      materialRate: String(materialRate ?? 0),
      laborRate: String(laborRate ?? 0),
      equipmentRate: String(equipmentRate ?? 0),
      crewSize: String(crewSize ?? 1),
      productivityRate: String(productivityRate ?? 1),
      source: 'user_override',
      region: region ?? null,
    });

    await auditAndVersion(req, 'unit_rates', rate.id, existing ? 'update' : 'create', existing ?? null, rate);

    res.json({ ok: true, rate });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/rates/unit/bulk — Bulk import unit rates (admin only) */
rateManagementRouter.post('/unit/bulk', requireAdmin, async (req, res) => {
  try {
    const { rates } = req.body;
    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ ok: false, error: 'rates array is required' });
    }

    let imported = 0;
    for (const r of rates) {
      if (!r.csiCode || !r.description || !r.unit) continue;
      const existing = await storage.getUnitRate(r.csiCode, r.region);
      const rate = await storage.upsertUnitRate({
        csiCode: r.csiCode,
        description: r.description,
        unit: r.unit,
        materialRate: String(r.materialRate ?? 0),
        laborRate: String(r.laborRate ?? 0),
        equipmentRate: String(r.equipmentRate ?? 0),
        crewSize: String(r.crewSize ?? 1),
        productivityRate: String(r.productivityRate ?? 1),
        source: r.source ?? 'user_override',
        region: r.region ?? null,
      });
      await auditAndVersion(req, 'unit_rates', rate.id, existing ? 'update' : 'import', existing ?? null, rate);
      imported++;
    }

    res.json({ ok: true, imported, total: rates.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MEP RATES
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/rates/mep — List MEP rates (filterable by division) */
rateManagementRouter.get('/mep', async (req, res) => {
  try {
    const { division } = req.query;
    const rates = await storage.getMepRates(division as string);
    res.json({ ok: true, count: rates.length, rates });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/mep/export — Export MEP rates as CSV */
rateManagementRouter.get('/mep/export', async (req, res) => {
  try {
    const rates = await storage.getMepRates();
    const header = 'csiCode,division,description,unit,materialRate,labourRate,unitRate,labourHoursPerUnit,tradeLocal,source,region';
    const rows = rates.map(r =>
      [r.csiCode, r.division, `"${(r.description ?? '').replace(/"/g, '""')}"`, r.unit, r.materialRate, r.labourRate, r.unitRate, r.labourHoursPerUnit, r.tradeLocal ?? '', r.source, r.region ?? ''].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="mep-rates.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/rates/mep/import — Import MEP rates from CSV body (admin only) */
rateManagementRouter.post('/mep/import', requireAdmin, async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ ok: false, error: 'csv string is required in request body' });
    }

    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    let imported = 0;
    let errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = vals[idx]?.trim() ?? ''; });

      if (!row.csicode || !row.description || !row.unit || !row.division) {
        errors.push(`Row ${i + 1}: missing required fields`);
        continue;
      }

      const existing = await storage.getMepRateByCode(row.csicode, row.region || null);
      const rate = await storage.upsertMepRate({
        csiCode: row.csicode,
        division: row.division,
        description: row.description,
        unit: row.unit,
        materialRate: row.materialrate || '0',
        labourRate: row.labourrate || '0',
        unitRate: row.unitrate || '0',
        labourHoursPerUnit: row.labourhoursperunit || '1',
        tradeLocal: row.tradelocal || null,
        source: 'user_override',
        region: row.region || null,
      });
      await auditAndVersion(req, 'mep_rates', rate.id, existing ? 'update' : 'import', existing ?? null, rate);
      imported++;
    }

    res.json({ ok: true, imported, total: lines.length - 1, errors: errors.length > 0 ? errors : undefined });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/rates/mep/:csiCode — Update or create a MEP rate (admin only) */
rateManagementRouter.put('/mep/:csiCode', requireAdmin, async (req, res) => {
  try {
    const { csiCode } = req.params;
    const { division, description, unit, materialRate, labourRate, unitRate, labourHoursPerUnit, tradeLocal, region } = req.body;

    if (!description || !unit || !division) {
      return res.status(400).json({ ok: false, error: 'division, description, and unit are required' });
    }

    const existing = await storage.getMepRateByCode(csiCode, region);

    const rate = await storage.upsertMepRate({
      csiCode,
      division,
      description,
      unit,
      materialRate: String(materialRate ?? 0),
      labourRate: String(labourRate ?? 0),
      unitRate: String(unitRate ?? 0),
      labourHoursPerUnit: String(labourHoursPerUnit ?? 1),
      tradeLocal: tradeLocal ?? null,
      source: 'user_override',
      region: region ?? null,
    });

    await auditAndVersion(req, 'mep_rates', rate.id, existing ? 'update' : 'create', existing ?? null, rate);

    res.json({ ok: true, rate });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// REGIONAL FACTORS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/rates/regional — List all regional factors */
rateManagementRouter.get('/regional', async (req, res) => {
  try {
    const factors = await storage.getRegionalFactors();
    res.json({ ok: true, count: factors.length, factors });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/regional/export — Export regional factors as CSV */
rateManagementRouter.get('/regional/export', async (req, res) => {
  try {
    const factors = await storage.getRegionalFactors();
    const header = 'regionKey,regionLabel,province,compositeIndex,materialIndex,laborIndex,equipmentIndex,transportFactor,remoteFactor,hstGstRate,pstRate,taxDescription';
    const rows = factors.map(r =>
      [r.regionKey, `"${r.regionLabel}"`, r.province, r.compositeIndex, r.materialIndex, r.laborIndex, r.equipmentIndex, r.transportFactor, r.remoteFactor, r.hstGstRate, r.pstRate, r.taxDescription ?? ''].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="regional-factors.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** GET /api/rates/regional/:regionKey — Get a single regional factor */
rateManagementRouter.get('/regional/:regionKey', async (req, res) => {
  try {
    const regionKey = decodeURIComponent(req.params.regionKey);
    const factor = await storage.getRegionalFactor(regionKey);
    if (!factor) {
      return res.status(404).json({ ok: false, error: `No regional factor found for ${regionKey}` });
    }
    res.json({ ok: true, factor });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/rates/regional/:regionKey — Update or create a regional factor (admin only) */
rateManagementRouter.put('/regional/:regionKey', requireAdmin, async (req, res) => {
  try {
    const regionKey = decodeURIComponent(req.params.regionKey);
    const { regionLabel, province, compositeIndex, materialIndex, laborIndex, equipmentIndex, transportFactor, remoteFactor, hstGstRate, pstRate, taxDescription } = req.body;

    if (!regionLabel || !province) {
      return res.status(400).json({ ok: false, error: 'regionLabel and province are required' });
    }

    const existing = await storage.getRegionalFactor(regionKey);

    const factor = await storage.upsertRegionalFactor({
      regionKey,
      regionLabel,
      province,
      compositeIndex: String(compositeIndex ?? 1.0),
      materialIndex: String(materialIndex ?? 1.0),
      laborIndex: String(laborIndex ?? 1.0),
      equipmentIndex: String(equipmentIndex ?? 1.0),
      transportFactor: String(transportFactor ?? 1.0),
      remoteFactor: String(remoteFactor ?? 1.0),
      hstGstRate: String(hstGstRate ?? 0.13),
      pstRate: String(pstRate ?? 0),
      taxDescription: taxDescription ?? null,
    });

    await auditAndVersion(req, 'regional_factors', factor.id, existing ? 'update' : 'create', existing ?? null, factor);

    res.json({ ok: true, factor });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT OH&P CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/rates/ohp/:projectId — Get OH&P configuration for a project */
rateManagementRouter.get('/ohp/:projectId', async (req, res) => {
  try {
    const config = await storage.getProjectOhpConfig(req.params.projectId);
    if (!config) {
      return res.json({ ok: true, configured: false, message: 'No OH&P configured — system fallback will be used' });
    }
    res.json({ ok: true, configured: true, config });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** PUT /api/rates/ohp/:projectId — Set OH&P configuration for a project (admin only) */
rateManagementRouter.put('/ohp/:projectId', requireAdmin, async (req, res) => {
  try {
    const { overheadPct, profitPct, contingencyPct, applyToSubcontractorCosts, applyToEquipmentCosts, projectNotes } = req.body;

    const existing = await storage.getProjectOhpConfig(req.params.projectId);

    const config = await storage.upsertProjectOhpConfig({
      projectId: req.params.projectId,
      overheadPct: String(overheadPct ?? 0.15),
      overheadSource: 'PROJECT_CONFIGURED',
      overheadConfidence: 'HIGH',
      profitPct: String(profitPct ?? 0.10),
      profitSource: 'PROJECT_CONFIGURED',
      profitConfidence: 'HIGH',
      contingencyPct: String(contingencyPct ?? 0.05),
      contingencySource: 'PROJECT_CONFIGURED',
      contingencyConfidence: 'HIGH',
      applyToSubcontractorCosts: applyToSubcontractorCosts ?? true,
      applyToEquipmentCosts: applyToEquipmentCosts ?? true,
      projectNotes: projectNotes ?? null,
    });

    await auditAndVersion(req, 'project_ohp_configs', config.id, existing ? 'update' : 'create', existing ?? null, config);

    res.json({ ok: true, config });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CSV parsing helper ──────────────────────────────────────────────────────

/** Simple CSV line parser that handles quoted fields with commas */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
