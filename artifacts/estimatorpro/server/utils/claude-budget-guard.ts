// server/utils/claude-budget-guard.ts
import { logger } from './enterprise-logger';

/**
 * Estimate input tokens from a Claude messages.create() call params.
 * Rough estimate: ~4 chars per token for English text.
 */
export function estimateInputTokens(params: any): number {
  let chars = 0;

  // System prompt
  if (typeof params.system === 'string') {
    chars += params.system.length;
  } else if (Array.isArray(params.system)) {
    chars += params.system.reduce((sum: number, b: any) => sum + (b?.text?.length || 0), 0);
  }

  // Messages
  if (Array.isArray(params.messages)) {
    for (const msg of params.messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.text) chars += block.text.length;
          // Images: ~1000 tokens per image (rough estimate)
          if (block?.type === 'image') chars += 4000;
          if (block?.type === 'document') chars += 8000;
        }
      }
    }
  }

  return Math.ceil(chars / 4);
}

/**
 * Check budget before a Claude API call. Returns true if allowed, false if blocked.
 * Logs a warning when blocked but does NOT throw — callers decide how to handle.
 */
export async function checkBudget(params: any, operation: string): Promise<boolean> {
  try {
    const { claudeCostMonitor } = await import('../services/claude-cost-monitor');
    const estimatedTokens = estimateInputTokens(params);
    const check = await claudeCostMonitor.checkBudgetBeforeCall(
      estimatedTokens,
      params.model || 'claude-sonnet-4-20250514'
    );
    if (!check.allowed) {
      logger.warn(`Budget guard blocked ${operation}: ${check.reason}`, {
        operation,
        estimatedTokens,
        remainingBudget: check.remainingBudget,
      });
      return false;
    }
    return true;
  } catch {
    // If cost monitor fails, allow the call — don't block production
    return true;
  }
}

/**
 * Track cost after a Claude API call completes.
 */
export async function trackCost(
  response: any,
  model: string,
  operation: string,
  documentId?: string
): Promise<void> {
  try {
    const { claudeCostMonitor } = await import('../services/claude-cost-monitor');
    const inputTokens = response?.usage?.input_tokens || 0;
    const outputTokens = response?.usage?.output_tokens || 0;
    await claudeCostMonitor.trackApiCall(model, inputTokens, outputTokens, documentId, operation);
  } catch {
    // Non-fatal — don't let tracking failures break production
  }
}
