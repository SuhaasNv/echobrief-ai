/**
 * Error retry wrapper with exponential backoff.
 * 
 * Provides resilient retry logic for transient failures in external services:
 * - OpenAI API calls
 * - AssemblyAI transcription
 * - Database queries (connection errors)
 * - Redis operations
 * 
 * Usage:
 *   import { withRetry } from "./retry";
 *   
 *   const result = await withRetry(
 *     () => fetch("https://api.external.com/data"),
 *     {
 *       maxAttempts: 3,
 *       backoffMs: 1000,
 *       onRetry: (attempt, error) => console.warn(`Retry ${attempt}:`, error)
 *     }
 *   );
 * 
 * Backoff Strategy:
 *   - Attempt 1: No delay
 *   - Attempt 2: 1000ms (1s)
 *   - Attempt 3: 2000ms (2s)
 *   - Attempt 4: 4000ms (4s)
 *   - etc. (exponential backoff)
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial backoff delay in milliseconds (default: 1000ms) */
  backoffMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum backoff delay in milliseconds (default: 30000ms = 30s) */
  maxBackoffMs?: number;
  /** Callback invoked before each retry */
  onRetry?: (attempt: number, error: Error) => void;
  /** Optional jitter to prevent thundering herd (default: true) */
  jitter?: boolean;
}

/**
 * Retry a function with exponential backoff on failure.
 * 
 * @param fn - Async function to retry
 * @param options - Retry configuration
 * @returns Result from successful attempt
 * @throws Last error if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    backoffMs = 1000,
    backoffMultiplier = 2,
    maxBackoffMs = 30_000,
    onRetry,
    jitter = true,
  } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Last attempt - throw error
      if (attempt === maxAttempts) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      let delay = backoffMs * Math.pow(backoffMultiplier, attempt - 1);
      delay = Math.min(delay, maxBackoffMs);
      
      // Add jitter to prevent thundering herd
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      
      console.warn(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms...`,
        error instanceof Error ? error.message : error
      );
      
      // Invoke callback
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached, but TypeScript doesn't know that
  throw lastError || new Error("Retry failed with unknown error");
}

/**
 * Retry with specific error type handling.
 * Only retries if the error matches a specific condition.
 * 
 * @param fn - Async function to retry
 * @param shouldRetry - Predicate to determine if error is retryable
 * @param options - Retry configuration
 * @returns Result from successful attempt
 */
export async function withConditionalRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: Error) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, backoffMs = 1000, onRetry } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Check if error is retryable
      if (!shouldRetry(lastError)) {
        console.warn(`[Retry] Non-retryable error on attempt ${attempt}, throwing immediately`);
        throw error;
      }
      
      // Last attempt - throw error
      if (attempt === maxAttempts) {
        throw error;
      }
      
      const delay = backoffMs * Math.pow(2, attempt - 1);
      
      console.warn(
        `[Retry] Attempt ${attempt}/${maxAttempts} failed with retryable error, retrying in ${delay}ms...`,
        lastError.message
      );
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error("Retry failed with unknown error");
}

/**
 * Common retry condition: network errors.
 * Retries on connection errors, timeouts, etc.
 */
export function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("timeout")
  );
}

/**
 * Common retry condition: rate limit errors (429).
 * Retries on rate limit / too many requests errors.
 */
export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  );
}

/**
 * Common retry condition: server errors (5xx).
 * Retries on internal server errors, bad gateway, service unavailable, etc.
 */
export function isServerError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("bad gateway") ||
    message.includes("service unavailable")
  );
}
