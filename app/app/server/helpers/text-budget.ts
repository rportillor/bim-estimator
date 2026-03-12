// server/helpers/text-budget.ts
export function estimateTokensForText(s: string): number {
  // conservative rough estimate: ~4 chars/token
  return Math.ceil((s?.length || 0) / 4);
}

export function selectWithinBudget(pages: string[], targetTokens: number) {
  const selected: string[] = [];
  let used = 0;
  for (const p of pages) {
    const t = estimateTokensForText(p);
    if (used + t > targetTokens) break;
    selected.push(p);
    used += t;
  }
  return { selected, used };
}

export function chunkByTokens(pages: string[], perChunkTokens: number) {
  const chunks: string[] = [];
  let cur: string[] = [], used = 0;
  for (const p of pages) {
    const t = estimateTokensForText(p);
    if (used + t > perChunkTokens) {
      chunks.push(cur.join("\n\n----\n\n"));
      cur = [p];
      used = t;
    } else {
      cur.push(p);
      used += t;
    }
  }
  if (cur.length) chunks.push(cur.join("\n\n----\n\n"));
  return chunks;
}