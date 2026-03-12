// server/helpers/legend-lexicon.ts
export type CanonicalSymbol =
  | "LIGHT_FIXTURE" | "EMERGENCY_LIGHT" | "EXIT_SIGN"
  | "SPRINKLER" | "FIRE_ALARM_DEVICE"
  | "RECEPTACLE" | "SWITCH" | "PANEL"
  | "DIFFUSER" | "RETURN" | "VAV" | "DUCT_TAG"
  | "PLUMBING_FIXTURE" | "FLOOR_DRAIN"
  | "COLUMN" | "GRID_REF" | "DOOR" | "WINDOW";

export const LEGEND_MAP: Array<{ re: RegExp; type: CanonicalSymbol; hints?: string[] }> = [
  { re: /\b(light(ing)? fixture|troffer|downlight|strip light|led)\b/i, type: "LIGHT_FIXTURE" },
  { re: /\b(emergency light|egress light)\b/i, type: "EMERGENCY_LIGHT" },
  { re: /\b(exit sign)\b/i, type: "EXIT_SIGN" },
  { re: /\b(sprinkler head|pendant|upright|sidewall)\b/i, type: "SPRINKLER" },
  { re: /\b(receptacle|outlet|duplex|quad)\b/i, type: "RECEPTACLE" },
  { re: /\b(switch|3-way|4-way|dimmer)\b/i, type: "SWITCH" },
  { re: /\b(panel schedule|panel\s*[A-Z0-9-]+|panelboard)\b/i, type: "PANEL" },
  { re: /\b(diffuser|register|grille)\b/i, type: "DIFFUSER" },
  { re: /\b(return( air)?)( grille| duct)?\b/i, type: "RETURN" },
  { re: /\b(VAV|variable air volume)\b/i, type: "VAV" },
  { re: /\b(duct)\b/i, type: "DUCT_TAG" },
  { re: /\b(lav|water closet|W\.C\.|urinal|shower|sink|hose bibb)\b/i, type: "PLUMBING_FIXTURE" },
  { re: /\b(floor drain|FD)\b/i, type: "FLOOR_DRAIN" },
  { re: /\b(grid\s*(?:[A-Z]|\d+))\b/i, type: "GRID_REF" },
  { re: /\b(column)\b/i, type: "COLUMN" },
  { re: /\b(door)\b/i, type: "DOOR" },
  { re: /\b(window)\b/i, type: "WINDOW" }
];