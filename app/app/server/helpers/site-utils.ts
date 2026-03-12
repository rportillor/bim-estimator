// server/helpers/site-utils.ts
import { pointInPolygon, toPt } from "./polygon-utils";

export function markInsideProperty(elements: any[], propertyLine?: Array<{x:number;y:number}>) {
  if (!Array.isArray(propertyLine) || propertyLine.length < 3) return elements;
  const out: any[] = [];
  for (const e of elements) {
    const loc = e?.geometry?.location?.realLocation || e?.properties?.realLocation || { x: 0, y: 0 };
    const p = toPt(loc);
    const inside = pointInPolygon(p, propertyLine);
    const next = { ...e, properties: { ...(e?.properties || {}), insideProperty: inside } };
    out.push(next);
  }
  return out;
}

export function attachLegendTags(elements: any[], legend?: {label:string; keys:string[]}[], legendLineTypes?: {label:string; desc:string; regex?:string}[]) {
  if (!Array.isArray(legend) && !Array.isArray(legendLineTypes)) return elements;
  const out: any[] = [];

  for (const e of elements) {
    const T = String(e?.type || e?.category || e?.name || "").toUpperCase();
    const tags: string[] = [...(e?.properties?.legendTags || [])];

    if (Array.isArray(legend)) {
      for (const L of legend) {
        const keys = (L?.keys || []).map(k => String(k || "").toUpperCase());
        if (keys.some(k => k && T.includes(k))) tags.push(L.label || "");
      }
    }

    // Optional: if element name describes a line type and legend has a line-type label, tag it.
    if (Array.isArray(legendLineTypes)) {
      for (const L of legendLineTypes) {
        const rx = L?.regex ? new RegExp(L.regex, "i") : null;
        const matchByDesc = L?.desc ? new RegExp(L.desc, "i").test(T) : false;
        if ((rx && rx.test(T)) || matchByDesc) tags.push(L.label || "");
      }
    }

    const next = { ...e };
    if (tags.length) {
      next.properties = next.properties || {};
      next.properties.legendTags = Array.from(new Set(tags.filter(Boolean)));
    }
    out.push(next);
  }

  return out;
}

export function applySiteContext(elements: any[], site?: { property_line?: {x:number;y:number}[], legend?: {label:string;keys:string[]}[], legend_line_types?: {label:string;desc:string;regex?:string}[] }) {
  const e1 = markInsideProperty(elements, site?.property_line);
  const e2 = attachLegendTags(e1, site?.legend || [], site?.legend_line_types || []);
  return e2;
}