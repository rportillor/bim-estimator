// server/services/estimate-export.ts
import { deriveQuantitiesForElements } from "../helpers/quantity-derive";
import { assignRenderColors } from "../helpers/render-colors";
import { getRateProfile, pickRuleFor, RateProfile } from "./rates";

/* ---------------- base rows (unchanged) ---------------- */

type Row = {
  id: string; name: string; type: string; trade: string; storey: string;
  width_m: number; depth_m: number; height_m: number; thickness_m: number;
  length_m: number; area_m2: number; volume_m3: number;
  x: number; y: number; z: number; yaw_deg: number;
};

const cols: (keyof Row)[] = [
  "id","name","type","trade","storey",
  "width_m","depth_m","height_m","thickness_m",
  "length_m","area_m2","volume_m3",
  "x","y","z","yaw_deg"
];

const fmt = (n: any, d = 3) => {
  const v = Number(n); return Number.isFinite(v) ? v.toFixed(d) : "";
};

function toRow(e: any): Row {
  const dims = e?.geometry?.dimensions || {};
  const loc  = e?.geometry?.location?.realLocation || {};
  const ori  = e?.geometry?.orientation || {};
  // ✅ FIX: Handle both quantity field variations
  const q    = e?.quantities || e?.quantity || {};
  return {
    id: String(e?.id ?? ""),
    name: String(e?.name ?? ""),
    type: String(e?.type ?? e?.category ?? ""),
    trade: String(q?.trade ?? ""),
    storey: String(e?.storey?.name ?? e?.properties?.level ?? e?.properties?.storey ?? ""),
    width_m: Number(dims?.width ?? 0) || 0,
    depth_m: Number(dims?.depth ?? 0) || 0,
    height_m: Number(dims?.height ?? 0) || 0,
    thickness_m: Number(e?.properties?.thickness_m ?? 0) || 0,
    length_m: Number(q?.length_m ?? 0) || 0,
    area_m2: Number(q?.area_m2 ?? 0) || 0,
    volume_m3: Number(q?.volume_m3 ?? 0) || 0,
    x: Number(loc?.x ?? 0) || 0,
    y: Number(loc?.y ?? 0) || 0,
    z: Number(loc?.z ?? 0) || 0,
    yaw_deg: Number(ori?.yawDeg ?? 0) || 0,
  };
}

export function buildEstimateRows(elements: any[]): Row[] {
  const qto = deriveQuantitiesForElements(elements);
  const colored = assignRenderColors(qto.elements);
  return colored.map(toRow);
}

export function buildEstimateCsv(elements: any[], delimiter = ",", decimals = 3): string {
  const rows = buildEstimateRows(elements);
  const header = cols.join(delimiter);
  const lines = rows.map(r =>
    cols.map(k => {
      const v = (r as any)[k];
      if (typeof v === "number") return fmt(v, decimals);
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(delimiter)
  );
  return [header, ...lines].join("\n");
}

/* ---------------- unit conversions ---------------- */
const M2FT = 3.280839895; // m -> ft
const M2FT2 = 10.763910416; // m2 -> ft2
const M2FT3 = 35.31466672; // m3 -> ft3

function convertQty(n: number, unit: "m"|"m2"|"m3"|"ea"|"ft"|"ft2"|"ft3", toUnits: "metric"|"imperial") {
  if (!Number.isFinite(n)) return 0;
  if (unit === "ea") return n;
  if (toUnits === "metric") {
    // source assumed metric already
    if (unit === "m" || unit === "m2" || unit === "m3") return n;
    if (unit === "ft")  return n / M2FT;
    if (unit === "ft2") return n / M2FT2;
    if (unit === "ft3") return n / M2FT3;
  } else { // imperial
    if (unit === "m")  return n * M2FT;
    if (unit === "m2") return n * M2FT2;
    if (unit === "m3") return n * M2FT3;
    if (unit === "ft" || unit === "ft2" || unit === "ft3") return n;
  }
  return n;
}

/* ---------------- costing ---------------- */

export type CostRow = Row & {
  cost_unit: "m"|"m2"|"m3"|"ea"|"ft"|"ft2"|"ft3";
  cost_qty: number;
  cost_rate: number;
  cost_currency: string;
  cost_amount: number;
  rate_note?: string;
  rate_profile: string;
};

export function quantifyCostForRow(r: Row, profile: RateProfile): CostRow {
  const rule = pickRuleFor(r.type, profile);
  const out: CostRow = {
    ...r,
    cost_unit: (rule?.unit || (profile.units === "imperial" ? "ft" : "m")) as any,
    cost_qty: 0,
    cost_rate: Number(rule?.rate || 0),
    cost_currency: profile.currency,
    cost_amount: 0,
    rate_note: rule?.note,
    rate_profile: profile.name
  };

  // choose base quantity based on unit
  let base = 0;
  switch (out.cost_unit) {
    case "m":   base = r.length_m; break;
    case "m2":  base = r.area_m2 || (r.length_m * r.height_m); break;
    case "m3":  base = r.volume_m3 || (r.area_m2 * r.thickness_m); break;
    case "ea":  base = 1; break;
    case "ft":  base = convertQty(r.length_m, "m",  "imperial"); break;
    case "ft2": base = convertQty(r.area_m2 || (r.length_m * r.height_m), "m2", "imperial"); break;
    case "ft3": base = convertQty(r.volume_m3 || (r.area_m2 * r.thickness_m), "m3", "imperial"); break;
  }

  // If profile units mismatch row units, convert row to profile's unit system
  const needImperial = profile.units === "imperial";
  if (!needImperial) {
    // metric profile: ensure m/m2/m3
    if (out.cost_unit === "ft")  { base = convertQty(base, "ft",  "metric"); out.cost_unit = "m"; }
    if (out.cost_unit === "ft2") { base = convertQty(base, "ft2", "metric"); out.cost_unit = "m2"; }
    if (out.cost_unit === "ft3") { base = convertQty(base, "ft3", "metric"); out.cost_unit = "m3"; }
  } else {
    // imperial profile: ensure ft/ft2/ft3
    if (out.cost_unit === "m")  { base = convertQty(base, "m",  "imperial"); out.cost_unit = "ft"; }
    if (out.cost_unit === "m2") { base = convertQty(base, "m2", "imperial"); out.cost_unit = "ft2"; }
    if (out.cost_unit === "m3") { base = convertQty(base, "m3", "imperial"); out.cost_unit = "ft3"; }
  }

  out.cost_qty = Number.isFinite(base) ? base : 0;
  out.cost_amount = +(out.cost_qty * out.cost_rate).toFixed(2);
  return out;
}

export function buildEstimateCostRows(elements: any[], units: "metric"|"imperial" = "metric", profileName?: string): CostRow[] {
  const rows = buildEstimateRows(elements);
  const profile = getRateProfile(profileName, units);
  return rows.map(r => quantifyCostForRow(r, profile));
}

export function buildEstimateCostCsv(elements: any[], units: "metric"|"imperial", profileName?: string, delimiter = ",", decimals = 3): string {
  const rows = buildEstimateCostRows(elements, units, profileName);
  const header = [
    ...cols,
    "cost_unit","cost_qty","cost_rate","cost_currency","cost_amount","rate_profile","rate_note"
  ].join(delimiter);

  const lines = rows.map(r => {
    const vals = [
      ...cols.map(k => (typeof (r as any)[k] === "number" ? fmt((r as any)[k], decimals) : String((r as any)[k] ?? ""))),
      r.cost_unit,
      fmt(r.cost_qty, decimals),
      String(r.cost_rate),
      r.cost_currency,
      String(r.cost_amount),
      r.rate_profile,
      (r.rate_note || "").replace(/"/g, '""')
    ];
    return vals.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(delimiter);
  });
  return [header, ...lines].join("\n");
}

/* -------- grouped (with cost) -------- */

export type GroupKey = "trade" | "type" | "storey";
export type GroupedRow = {
  key: string; trade?: string; type?: string; storey?: string;
  count: number; length_m: number; area_m2: number; volume_m3: number; thickness_m_avg?: number;
  cost_currency?: string; cost_amount?: number;
};

function groupKeyFor(row: { [k:string]: any }, keys: GroupKey[]): string {
  return keys.map(k => (row as any)[k] ?? "").join("|");
}

export function buildEstimateGroupedRows(elements: any[], keys: GroupKey[]): GroupedRow[] {
  const rows = buildEstimateRows(elements);
  const map = new Map<string, GroupedRow & { _thickSum: number }>();
  for (const r of rows) {
    const gk = groupKeyFor(r, keys);
    const cur = map.get(gk) || {
      key: gk, trade: keys.includes("trade") ? r.trade : undefined,
      type: keys.includes("type") ? r.type : undefined,
      storey: keys.includes("storey") ? r.storey : undefined,
      count: 0, length_m: 0, area_m2: 0, volume_m3: 0, _thickSum: 0, thickness_m_avg: 0
    };
    cur.count += 1;
    cur.length_m += r.length_m;
    cur.area_m2  += r.area_m2;
    cur.volume_m3+= r.volume_m3;
    cur._thickSum+= r.thickness_m;
    map.set(gk, cur);
  }
  const out: GroupedRow[] = [];
  for (const v of Array.from(map.values())) {
    const avg = v.count ? v._thickSum / v.count : 0;
    out.push({ ...v, thickness_m_avg: avg });
  }
  out.sort((a, b) => (b.volume_m3 - a.volume_m3) || (b.length_m - a.length_m) || (b.area_m2 - a.area_m2));
  return out;
}

export function buildEstimateGroupedCsv(elements: any[], keys: GroupKey[], delimiter = ",", decimals = 3): string {
  const rows = buildEstimateGroupedRows(elements, keys);
  const header = [
    ...(keys.includes("trade") ? ["trade"] : []),
    ...(keys.includes("type") ? ["type"] : []),
    ...(keys.includes("storey") ? ["storey"] : []),
    "count","length_m","area_m2","volume_m3","thickness_m_avg"
  ].join(delimiter);

  const lines = rows.map(r => {
    const vals: (string|number)[] = [];
    if (keys.includes("trade"))  vals.push(r.trade ?? "");
    if (keys.includes("type"))   vals.push(r.type ?? "");
    if (keys.includes("storey")) vals.push(r.storey ?? "");
    vals.push(r.count, fmt(r.length_m, decimals), fmt(r.area_m2, decimals), fmt(r.volume_m3, decimals), fmt(r.thickness_m_avg ?? 0, decimals));
    return vals.map(v => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(delimiter);
  });
  return [header, ...lines].join("\n");
}

/* grouped with cost */
export function buildEstimateGroupedCostCsv(elements: any[], keys: GroupKey[], units: "metric"|"imperial", profileName?: string, delimiter = ",", decimals = 3): string {
  const rows = buildEstimateCostRows(elements, units, profileName);
  const map = new Map<string, { cost: number; currency: string; count: number; len: number; area: number; vol: number; thickSum: number; trade?: string; type?: string; storey?: string; }>();

  for (const r of rows) {
    const gk = groupKeyFor(r, keys);
    const cur = map.get(gk) || { cost: 0, currency: r.cost_currency, count: 0, len: 0, area: 0, vol: 0, thickSum: 0,
      trade: keys.includes("trade") ? r.trade : undefined,
      type: keys.includes("type") ? r.type : undefined,
      storey: keys.includes("storey") ? r.storey : undefined
    };
    cur.cost += r.cost_amount;
    cur.count += 1;
    cur.len += r.length_m;
    cur.area += r.area_m2;
    cur.vol += r.volume_m3;
    cur.thickSum += r.thickness_m;
    map.set(gk, cur);
  }

  const header = [
    ...(keys.includes("trade") ? ["trade"] : []),
    ...(keys.includes("type") ? ["type"] : []),
    ...(keys.includes("storey") ? ["storey"] : []),
    "count","length_m","area_m2","volume_m3","thickness_m_avg","cost_currency","cost_amount"
  ].join(delimiter);

  const lines: string[] = [];
  for (const v of Array.from(map.values())) {
    const avgT = v.count ? v.thickSum / v.count : 0;
    const vals: (string|number)[] = [];
    if (keys.includes("trade")) vals.push(v.trade ?? "");
    if (keys.includes("type"))  vals.push(v.type ?? "");
    if (keys.includes("storey"))vals.push(v.storey ?? "");
    vals.push(v.count, fmt(v.len, decimals), fmt(v.area, decimals), fmt(v.vol, decimals), fmt(avgT, decimals), v.currency, v.cost.toFixed(2));
    lines.push(vals.map(w => /[",\n]/.test(String(w)) ? `"${String(w).replace(/"/g, '""')}"` : String(w)).join(delimiter));
  }
  return [header, ...lines].join("\n");
}

/* ---------------- XLSX with cost ---------------- */
export async function buildEstimateXlsxBuffer(elements: any[]): Promise<Buffer> {
  let XLSX: any;
  try { XLSX = (await import("xlsx" as any)); } catch { try { XLSX = require("xlsx" as any); } catch { throw new Error('xlsx module not installed'); } }
  const rows = buildEstimateRows(elements);
  const tradeTotals  = buildEstimateGroupedRows(elements, ["trade"]);
  const typeTotals   = buildEstimateGroupedRows(elements, ["type"]);
  const storeyTotals = buildEstimateGroupedRows(elements, ["storey"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows),        "Elements");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradeTotals), "TradeTotals");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(typeTotals),  "TypeTotals");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storeyTotals),"StoreyTotals");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function buildEstimateCostXlsxBuffer(elements: any[], units: "metric"|"imperial", profileName?: string): Promise<Buffer> {
  let XLSX: any;
  try { XLSX = (await import("xlsx" as any)); } catch { try { XLSX = require("xlsx" as any); } catch { throw new Error('xlsx module not installed'); } }
  const rows = buildEstimateCostRows(elements, units, profileName);
  const trades = buildEstimateGroupedRows(elements, ["trade"]);
  const types  = buildEstimateGroupedRows(elements, ["type"]);
  const stores = buildEstimateGroupedRows(elements, ["storey"]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows),   "ElementsCost");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trades), "TradeTotals");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(types),  "TypeTotals");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stores), "StoreyTotals");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}