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

/** Extract JSON object from freeform Claude text; returns {} on failure. */
export function parseFirstJsonObject(text: string): any {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : JSON.parse(text);
    } catch (error) {
      console.error('Failed to parse anthropic response as JSON:', error);
      return { error: 'Invalid JSON response', text };
    }
  } catch {
    return {};
  }
}

/** Extract JSON array from freeform Claude text; returns [] on failure. */
export function parseFirstJsonArray(text: string): any[] {
  try {
    const m = text.match(/\[[\s\S]*\]/);
    try {
      return m ? JSON.parse(m[0]) : JSON.parse(text);
    } catch (error) {
      console.error('Failed to parse anthropic response as JSON array:', error);
      return [];
    }
  } catch {
    return [];
  }
}