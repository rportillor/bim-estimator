import crypto from "crypto";

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitter: boolean;
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
  context = "operation"
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      if (attempt === options.maxAttempts) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      let delay = Math.min(
        options.baseDelayMs * Math.pow(options.multiplier, attempt - 1),
        options.maxDelayMs
      );
      
      // Add jitter if enabled
      if (options.jitter) {
        delay = delay * (0.5 + crypto.randomBytes(1)[0] / 255 * 0.5);
      }
      
      if (options.onRetry) {
        options.onRetry(error, attempt, delay);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}