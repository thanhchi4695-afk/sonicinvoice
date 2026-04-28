/**
 * Mobile-resilient fetch wrapper for long-running edge function calls.
 *
 * Why this exists:
 *   The Read phase of InvoiceFlow uploads a base64-encoded image/PDF to
 *   `/classify-extract-validate`. On mobile Safari (especially the installed
 *   PWA), background tab throttling + flaky cellular can silently kill the
 *   underlying request — the original `fetch` promise then never resolves OR
 *   rejects, leaving the UI stuck at "Searching" forever (see the 7m+ stall
 *   reported on iOS).
 *
 * What this does:
 *   - Wraps fetch in an AbortController with an explicit per-attempt timeout.
 *   - Retries on network error / 5xx / 408 / 429 with exponential back-off.
 *   - Surfaces a typed error so callers can show a real toast instead of
 *     hanging.
 */

export class FetchTimeoutError extends Error {
  constructor(public readonly timeoutMs: number, public readonly attempt: number) {
    super(`Request timed out after ${timeoutMs}ms (attempt ${attempt})`);
    this.name = "FetchTimeoutError";
  }
}

export class FetchRetryError extends Error {
  constructor(message: string, public readonly attempts: number, public readonly lastStatus?: number) {
    super(message);
    this.name = "FetchRetryError";
  }
}

export interface FetchWithRetryOptions extends RequestInit {
  /** Per-attempt timeout in milliseconds. Default: 90s (long enough for AI parsing). */
  timeoutMs?: number;
  /** Maximum number of attempts (incl. the first). Default: 3. */
  maxAttempts?: number;
  /** Base back-off delay; doubled each retry. Default: 800ms. */
  backoffMs?: number;
  /** Optional callback fired before each retry, useful for UI status updates. */
  onRetry?: (attempt: number, reason: string) => void;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  url: string,
  init: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 90_000,
    maxAttempts = 3,
    backoffMs = 800,
    onRetry,
    signal: externalSignal,
    ...rest
  } = init;

  let lastError: unknown;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Respect external aborts (e.g. user clicks "Cancel processing").
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        throw new DOMException("Aborted by caller", "AbortError");
      }
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);

      if (res.ok) return res;

      lastStatus = res.status;
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxAttempts) {
        return res; // let caller handle non-retryable / final failure
      }
      onRetry?.(attempt, `HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
      lastError = err;

      // External abort → bubble up immediately, no retry.
      if (externalSignal?.aborted) throw err;

      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      if (attempt === maxAttempts) {
        if (isTimeout) throw new FetchTimeoutError(timeoutMs, attempt);
        throw new FetchRetryError(
          err instanceof Error ? err.message : "Network request failed",
          attempt,
          lastStatus,
        );
      }
      onRetry?.(attempt, isTimeout ? "timeout" : "network");
    }

    // Exponential back-off with jitter
    const delay = backoffMs * Math.pow(2, attempt - 1) + Math.random() * 200;
    await new Promise((r) => setTimeout(r, delay));
  }

  // Should never get here, but TypeScript wants it.
  throw new FetchRetryError(
    lastError instanceof Error ? lastError.message : "Request failed",
    maxAttempts,
    lastStatus,
  );
}
