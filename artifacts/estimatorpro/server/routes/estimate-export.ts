// server/routes/estimate-export.ts
// =============================================================================
// Est-7: Dual-engine export routes.
//
// ?engine=ciqs (default)   → buildEstimateForModel() via estimate-engine.ts
//                            218 CSI rates, M+L+E breakdown, CIQS methodology
// ?engine=quicktakeoff     → buildEstimateCostRows() via rates.ts
//                            60 keyword rules, single all-in rate, fast QTO
//
// ?units=metric|imperial   — applies to quicktakeoff only (ciqs is always metric)
// =============================================================================
import { Router } from "express";
import { storage } from "../storage";
import {
  buildEstimateRows, buildEstimateCsv,
  buildEstimateGroupedRows, buildEstimateGroupedCsv,
  buildEstimateXlsxBuffer,
  buildEstimateCostRows, buildEstimateCostCsv, buildEstimateGroupedCostCsv, buildEstimateCostXlsxBuffer
} from "../services/estimate-export";

export const estimateExportRouter = Router();

type EngineParam = "ciqs" | "quicktakeoff";
function engineFrom(req: any): EngineParam {
  const e = String(req.query.engine || "ciqs").toLowerCase();
  return e === "quicktakeoff" ? "quicktakeoff" : "ciqs";
}
function unitsFrom(req: any): "metric" | "imperial" {
  const u = String(req.query.units || process.env.COST_UNITS || "metric").toLowerCase();
  return u === "imperial" ? "imperial" : "metric";
}
const profileFrom = (req: any) => String(req.query.profile || process.env.COST_PROFILE || "");

/* ----- CIQS engine helper -------------------------------------------------- */

async function buildCiqsCostRows(modelId: string): Promise<any[]> {
  const { buildEstimateForModel } = await import("../estimator/estimate-engine");
  const estimate = await buildEstimateForModel(modelId);
  return estimate.floors.flatMap((floor: any) =>
    floor.lineItems.map((item: any) => ({
      id: item.elementIds?.[0] || "",
      name: item.description,
      type: item.csiDivisionName || item.csiDivision,
      trade: item.csiDivision,
      storey: floor.floorLabel,
      width_m: 0, depth_m: 0, height_m: 0, thickness_m: 0,
      length_m: item.unit === "m" ? Number(item.quantity) : 0,
      area_m2: (item.unit === "m\u00b2" || item.unit === "m2") ? Number(item.quantity) : 0,
      volume_m3: (item.unit === "m\u00b3" || item.unit === "m3") ? Number(item.quantity) : 0,
      x: 0, y: 0, z: 0, yaw_deg: 0,
      cost_unit: item.unit,
      cost_qty: Number(item.quantity),
      cost_rate: Number(item.totalRate),
      cost_currency: "CAD",
      cost_amount: Number(item.totalCost),
      cost_material: Number(item.materialCost),
      cost_labour: Number(item.laborCost),
      cost_equipment: Number(item.equipmentCost),
      labour_hours: item.laborHours != null ? Number(item.laborHours.toFixed(2)) : 0,
      verification_status: item.verificationStatus || "estimated",
      rate_profile: "ciqs-professional",
      rate_note: `M:$${item.materialRate.toFixed(2)} L:$${item.laborRate.toFixed(2)} E:$${item.equipmentRate.toFixed(2)} /unit | ${item.verificationStatus || ""}`,
    }))
  );
}

function rowsToCsv(rows: any[], delimiter = ","): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(delimiter);
  const lines = rows.map(r =>
    keys.map(k => {
      const v = String((r as any)[k] ?? "");
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"`  : v;
    }).join(delimiter)
  );
  return [header, ...lines].join("\n");
}

/* ----- quantities ---------------------------------------------------------- */

estimateExportRouter.get("/bim/models/:modelId/estimate", async (req, res) => {
  try {
    const el = await storage.getBimElements(req.params.modelId);
    const rows = buildEstimateRows(el || []);
    const totals = rows.reduce((a, r) => ({ length_m: a.length_m + r.length_m, area_m2: a.area_m2 + r.area_m2, volume_m3: a.volume_m3 + r.volume_m3 }), { length_m: 0, area_m2: 0, volume_m3: 0 });
    res.json({ data: rows, totals, count: rows.length });
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to build estimate" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.csv", async (req, res) => {
  try {
    const el = await storage.getBimElements(req.params.modelId);
    const csv = buildEstimateCsv(el || [], ",", 3);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="estimate-${req.params.modelId}.csv"`);
    res.send(csv);
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to export estimate CSV" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.grouped", async (req, res) => {
  try {
    const keys = String(req.query.by || "trade").split(",").map((s: string) => s.trim()).filter(Boolean) as any[];
    const valid = ["trade","type","storey"]; const groupKeys = keys.filter(k => valid.includes(k));
    if (!groupKeys.length) return res.status(400).json({ message: "query ?by=trade[,type][,storey]" });
    const el = await storage.getBimElements(req.params.modelId);
    const rows = buildEstimateGroupedRows(el || [], groupKeys as any);
    res.json({ by: groupKeys, data: rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to build grouped estimate" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.grouped.csv", async (req, res) => {
  try {
    const keys = String(req.query.by || "trade").split(",").map((s: string) => s.trim()).filter(Boolean) as any[];
    const valid = ["trade","type","storey"]; const groupKeys = keys.filter(k => valid.includes(k));
    if (!groupKeys.length) return res.status(400).json({ message: "query ?by=trade[,type][,storey]" });
    const el = await storage.getBimElements(req.params.modelId);
    const csv = buildEstimateGroupedCsv(el || [], groupKeys as any, ",", 3);
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="estimate-grouped-${groupKeys.join("-")}-${req.params.modelId}.csv"`);
    res.send(csv);
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to export grouped CSV" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.xlsx", async (req, res) => {
  try {
    const el = await storage.getBimElements(req.params.modelId);
    const buf = await buildEstimateXlsxBuffer(el || []);
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="estimate-${req.params.modelId}.xlsx"`);
    res.send(buf);
  } catch (e: any) {
    if (/xlsx module not installed/i.test(e?.message || "")) return res.status(501).json({ message: e.message, install: "npm i xlsx" });
    res.status(500).json({ message: e?.message || "Failed to export XLSX" });
  }
});

/* ----- costing — DUAL ENGINE ----------------------------------------------- */

estimateExportRouter.get("/bim/models/:modelId/estimate.cost", async (req, res) => {
  try {
    const { modelId } = req.params;
    const engine = engineFrom(req);
    if (engine === "ciqs") {
      const rows = await buildCiqsCostRows(modelId);
      const total = rows.reduce((s: number, r: any) => s + r.cost_amount, 0);
      res.json({ engine: "ciqs", units: "metric", profile: "ciqs-professional", totals: { currency: "CAD", amount: total }, count: rows.length, data: rows });
    } else {
      const el = await storage.getBimElements(modelId); const units = unitsFrom(req); const profile = profileFrom(req);
      const rows = buildEstimateCostRows(el || [], units, profile);
      const totals = rows.reduce((a: any, r: any) => ({ currency: r.cost_currency, amount: a.amount + r.cost_amount }), { currency: rows[0]?.cost_currency || "CAD", amount: 0 });
      res.json({ engine: "quicktakeoff", units, profile: rows[0]?.rate_profile || (profile||"default"), totals, count: rows.length, data: rows });
    }
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to build costed estimate" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.cost.csv", async (req, res) => {
  try {
    const { modelId } = req.params; const engine = engineFrom(req);
    let csv: string; let filename: string;
    if (engine === "ciqs") {
      const rows = await buildCiqsCostRows(modelId);
      csv = rowsToCsv(rows); filename = `estimate-ciqs-${modelId}.csv`;
    } else {
      const el = await storage.getBimElements(modelId); const units = unitsFrom(req); const profile = profileFrom(req);
      csv = buildEstimateCostCsv(el || [], units, profile, ",", 3);
      filename = `estimate-quicktakeoff-${units}-${modelId}.csv`;
    }
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
    res.send(csv);
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to export cost CSV" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.grouped.cost.csv", async (req, res) => {
  try {
    const keys = String(req.query.by || "trade").split(",").map((s: string) => s.trim()).filter(Boolean) as any[];
    const valid = ["trade","type","storey"]; const groupKeys = keys.filter(k => valid.includes(k));
    if (!groupKeys.length) return res.status(400).json({ message: "query ?by=trade[,type][,storey]" });
    const el = await storage.getBimElements(req.params.modelId); const units = unitsFrom(req); const profile = profileFrom(req);
    const csv = buildEstimateGroupedCostCsv(el || [], groupKeys as any, units, profile, ",", 3);
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="estimate-grouped-cost-${groupKeys.join("-")}-${units}-${req.params.modelId}.csv"`);
    res.send(csv);
  } catch (e: any) { res.status(500).json({ message: e?.message || "Failed to export grouped cost CSV" }); }
});

estimateExportRouter.get("/bim/models/:modelId/estimate.cost.xlsx", async (req, res) => {
  try {
    const { modelId } = req.params; const engine = engineFrom(req);
    if (engine === "ciqs") {
      const rows = await buildCiqsCostRows(modelId);
      const fakeElements = rows.map((r: any) => ({
        id: r.id, elementType: r.type, storeyName: r.storey,
        geometry: { dimensions: { width: r.width_m, height: r.height_m, depth: r.depth_m } },
        quantities: { area_m2: r.area_m2, volume_m3: r.volume_m3, length_m: r.length_m },
      }));
      const buf = await buildEstimateCostXlsxBuffer(fakeElements, "metric", "ciqs-professional");
      res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",`attachment; filename="estimate-ciqs-${modelId}.xlsx"`);
      res.send(buf);
    } else {
      const el = await storage.getBimElements(modelId); const units = unitsFrom(req); const profile = profileFrom(req);
      const buf = await buildEstimateCostXlsxBuffer(el || [], units, profile);
      res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",`attachment; filename="estimate-quicktakeoff-${units}-${modelId}.xlsx"`);
      res.send(buf);
    }
  } catch (e: any) {
    if (/xlsx module not installed/i.test(e?.message || "")) return res.status(501).json({ message: e.message, install: "npm i xlsx" });
    res.status(500).json({ message: e?.message || "Failed to export cost XLSX" });
  }
});
