/**
 * Retry policy for outbound carrier calls.
 *
 * Carrier APIs rate limit (HTTP 429) and have transient 5xx windows. Without a
 * policy every such response surfaces to the caller as a hard failure, so the
 * HTTP client retries those — and only those — with exponential backoff.
 */

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_DELAY_MS = 5_000;

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_FLOOR = 500;
const MS_PER_SECOND = 1000;

export type RetryPolicy = {
  /** Total attempts including the first. `1` disables retrying. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
};

/**
 * 429 and 5xx are transient. Every other 4xx is a request the carrier will
 * reject identically on a retry, so retrying only wastes the caller's latency.
 */
export function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR_FLOOR;
}

/**
 * Backoff for the delay *after* `attempt` (1-based): base * 2^(attempt-1),
 * clamped to `maxDelayMs`. A `Retry-After` header wins when the carrier sent
 * one, because the carrier knows its own window better than we do.
 */
export function computeDelayMs(
  attempt: number,
  policy: RetryPolicy,
  retryAfterHeader?: string | null,
): number {
  const fromHeader = parseRetryAfterMs(retryAfterHeader);
  if (fromHeader !== undefined) {
    return Math.min(fromHeader, policy.maxDelayMs);
  }
  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, policy.maxDelayMs);
}

/** Accepts both `Retry-After` forms: delta-seconds and an HTTP date. */
export function parseRetryAfterMs(
  header: string | null | undefined,
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * MS_PER_SECOND;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
