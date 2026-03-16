// server/utils/anthropic-response.ts
export type ClaudeBlock = { type?: string; text?: string; [k: string]: any };
export type ClaudeResponse = { content?: ClaudeBlock[]; [k: string]: any } | any;

/** Extracts concatenated text from Anthropic SDK responses, tolerating variants. */
export function getTextFromClaude(resp: ClaudeResponse): string {
  try {
    const c = (resp as any)?.content;
    if (Array.isArray(c)) return c.map((b: any) => b?.text || "").join("\n");
    const maybe =
      (resp as any)?.content?.[0]?.text ??
      (resp as any)?.content ??
      (resp as any)?.output_text ??
      "";
    return String(maybe ?? "");
  } catch {
    return "";
  }
}

/**
 * Extract the FIRST complete JSON object from freeform Claude text using
 * brace-counting rather than a greedy regex. The greedy regex approach
 * (\{[\s\S]*\}) captures everything up to the LAST closing brace in the text,
 * which causes parse errors when Claude adds prose after the JSON block.
 * Returns {} on failure.
 */
export function parseFirstJsonObject(text: string): any {
  try {
    const start = text.indexOf('{');
    if (start === -1) {
      try { return JSON.parse(text); } catch { return {}; }
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    if (end === -1) {
      console.error('parseFirstJsonObject: no matching closing brace found');
      return {};
    }

    const jsonStr = text.slice(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse anthropic response as JSON:', error);
      return { error: 'Invalid JSON response', text };
    }
  } catch {
    return {};
  }
}

/**
 * Extract the FIRST complete JSON array from freeform Claude text using
 * bracket-counting rather than a greedy regex. Returns [] on failure.
 */
export function parseFirstJsonArray(text: string): any[] {
  try {
    const start = text.indexOf('[');
    if (start === -1) {
      try { return JSON.parse(text); } catch { return []; }
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    if (end === -1) {
      console.error('parseFirstJsonArray: no matching closing bracket found');
      return [];
    }

    const jsonStr = text.slice(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('Failed to parse anthropic response as JSON array:', error);
      return [];
    }
  } catch {
    return [];
  }
}
