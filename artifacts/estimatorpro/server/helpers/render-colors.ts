// server/helpers/render-colors.ts
// Assign stable, trade-aware colors to elements for the viewer.

type RGBHex = string;

const TRADE_COLORS: Record<string, RGBHex> = {
  architectural: "#8e9aaf",
  structural:    "#577590",
  mechanical:    "#43aa8b",
  plumbing:      "#90be6d",
  electrical:    "#f9c74f",
  fire:          "#f94144",
  default:       "#adb5bd",
};

// Optional type-specific overrides (takes precedence if name matches)
const TYPE_COLORS: Array<[RegExp, RGBHex]> = [
  [/WALL|FACADE/,    "#264653"],
  [/DOOR/,           "#2a9d8f"],
  [/WINDOW/,         "#00b4d8"],
  [/SLAB|FLOOR/,     "#a8dadc"],
  [/COLUMN/,         "#e76f51"],
  [/BEAM|LINTEL/,    "#f3722c"],
  [/DUCT|HVAC|VAV/,  "#43aa8b"],
  [/PIPE|RISER/,     "#90be6d"],
  [/TRAY|CABLE/,     "#577590"],
  [/CONDUIT/,        "#f9c74f"],
  [/PANEL|SWITCH/,   "#ffd166"],
  [/FIXTURE|LIGHT/,  "#ffafcc"],
];

function pickByType(typeName: string): RGBHex | null {
  const T = String(typeName || "").toUpperCase();
  for (const [re, color] of TYPE_COLORS) if (re.test(T)) return color;
  return null;
}

export function assignRenderColorToElement(e: any): any {
  const out = { ...e };
  out.properties = out.properties || {};

  // Respect existing color if present
  if (out.properties.renderColor) return out;

  const typeName = String(out.type || out.category || "");
  const trade = String(out.quantities?.trade || "").toLowerCase();

  const byType = pickByType(typeName);
  const byTrade = TRADE_COLORS[trade] || null;

  out.properties.renderColor = byType || byTrade || TRADE_COLORS.default;
  out.properties.renderOpacity = out.properties.renderOpacity ?? 0.95;

  return out;
}

export function assignRenderColors(elements: any[]): any[] {
  return (elements || []).map(assignRenderColorToElement);
}