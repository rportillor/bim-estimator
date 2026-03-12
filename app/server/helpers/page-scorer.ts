// server/helpers/page-scorer.ts
export function scorePage(text: string): number {
  if (!text) return 0;
  const t = text.slice(0, 20000);
  let s = 0;

  // Plans first
  if (/(site|parking|underground|garage|floor|roof|plan|grid|elevation|section|foundation|slab|column|beam|wall|door|window)/i.test(t)) s += 4;
  // Storey cues
  if (/(level\s*\d+|l\d+|basement|b\d+|ground|grade|mezz)/i.test(t)) s += 3;

  // Dimension richness
  const dimHits = Array.from(t.matchAll(/(\b\d+(\.\d+)?\s?(m|mm|cm|ft|')\b)|(\b\d{2,}\b)/ig)).length;
  s += Math.min(6, Math.floor(dimHits / 25));

  // Penalize spec/boilerplate pages
  if (/specification|legend|general notes|notes:|scope|index|revision history/i.test(t)) s -= 2;

  return Math.max(0, s);
}