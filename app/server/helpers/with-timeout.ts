// server/helpers/with-timeout.ts
// ✅ TIMEOUT FIX: Configurable timeouts with reasonable defaults for large projects
const DEFAULT_TIMEOUT = 300000; // 5 minutes for complex analysis
const CLAUDE_TIMEOUT = parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000"); // 5 min default

export async function withTimeout<T>(p: Promise<T>, ms: number = DEFAULT_TIMEOUT, label = "operation"): Promise<T> {
  let timer: any;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([p, timeout]); }
  finally { clearTimeout(timer); }
}

// Specific timeout for Claude AI operations
export async function withClaudeTimeout<T>(p: Promise<T>, label = "Claude analysis"): Promise<T> {
  return withTimeout(p, CLAUDE_TIMEOUT, label);
}