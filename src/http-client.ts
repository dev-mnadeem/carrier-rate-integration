import { CarrierError, networkError, parseError, timeoutError } from "./errors.js";
import { bodyForDiagnostics } from "./json.js";
import {
  computeDelayMs,
  defaultRetryPolicy,
  isRetryableStatus,
  realSleep,
  type RetryPolicy,
  type SleepFn,
} from "./retry.js";

export type FetchFn = typeof fetch;

const HTTP_OK_FLOOR = 200;
const HTTP_OK_CEILING = 300;
/** How much of a malformed body we keep when reporting a JSON parse failure. */
const PARSE_ERROR_SNIPPET_LIMIT = 500;

export type HttpRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

export type HttpResponse = {
  status: number;
  text: string;
  /** Lower-cased header name to value, so callers need not carry `Headers`. */
  headers: Record<string, string>;
};

export type HttpClientOptions = {
  retry?: RetryPolicy;
  /** Injected so tests can assert backoff without burning wall-clock time. */
  sleep?: SleepFn;
};

export function isSuccessStatus(status: number): boolean {
  return status >= HTTP_OK_FLOOR && status < HTTP_OK_CEILING;
}

/**
 * `fetch` with a per-request timeout, a retry policy for transient carrier
 * failures, and errors normalised into `CarrierError`.
 */
export class HttpClient {
  private readonly retry: RetryPolicy;
  private readonly sleep: SleepFn;

  constructor(
    private readonly fetchImpl: FetchFn,
    options: HttpClientOptions = {},
  ) {
    this.retry = options.retry ?? defaultRetryPolicy;
    this.sleep = options.sleep ?? realSleep;
  }

  /**
   * Performs the request, retrying transient failures. The final response is
   * returned whatever its status — interpreting status codes is the adapter's
   * job, because "401" means something different per carrier.
   */
  async request(req: HttpRequest): Promise<HttpResponse> {
    const maxAttempts = Math.max(1, this.retry.maxAttempts);
    let lastNetworkFailure: CarrierError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const isLastAttempt = attempt === maxAttempts;
      try {
        const res = await this.attempt(req);
        if (isLastAttempt || !isRetryableStatus(res.status)) {
          return res;
        }
        await this.sleep(
          computeDelayMs(attempt, this.retry, res.headers["retry-after"]),
        );
      } catch (e) {
        const failure = e instanceof CarrierError ? e : networkError(e);
        // A timeout is the caller's configured budget, not a transient blip.
        if (isLastAttempt || failure.kind === "timeout") throw failure;
        lastNetworkFailure = failure;
        await this.sleep(computeDelayMs(attempt, this.retry));
      }
    }

    throw lastNetworkFailure ?? networkError(new Error("Request failed"));
  }

  /** `request` plus JSON decoding. Non-2xx bodies are left to the caller. */
  async requestJson(req: HttpRequest): Promise<{
    status: number;
    headers: Record<string, string>;
    json: unknown;
    text: string;
  }> {
    const res = await this.request(req);
    return { ...res, json: this.decode(res.text) };
  }

  /** Parses a body that is required to be JSON, as a `parse` CarrierError. */
  decode(text: string): unknown {
    if (!text.length) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      throw parseError(
        "Invalid JSON in response body",
        e,
        bodyForDiagnostics(text, PARSE_ERROR_SNIPPET_LIMIT),
      );
    }
  }

  private async attempt(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await this.fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      return {
        status: res.status,
        text: await res.text(),
        headers: headersToRecord(res.headers),
      };
    } catch (e) {
      if (isAbort(e)) throw timeoutError();
      throw networkError(e);
    } finally {
      clearTimeout(timer);
    }
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function headersToRecord(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
