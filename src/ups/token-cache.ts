import { ZodError } from "zod";
import type { UpsIntegrationConfig } from "../config.js";
import { authError, fromZodError, parseError } from "../errors.js";
import { isSuccessStatus, type HttpClient } from "../http-client.js";
import { bodyForDiagnostics } from "../json.js";
import { oauthTokenResponseSchema } from "../schemas/ups.js";

const MS_PER_SECOND = 1000;
const OAUTH_SNIPPET_LIMIT = 500;

type CachedToken = {
  value: string;
  expiresAtMs: number;
};

/**
 * Holds the UPS client-credentials access token.
 *
 * Two behaviours matter here. The token is reused until `expires_in` minus a
 * configurable skew has elapsed, so a burst of rate calls costs one OAuth
 * round trip rather than one per call. And concurrent misses share a single
 * in-flight request: without that, N simultaneous first calls would each open
 * their own token request and UPS would see N authentications for one process.
 */
export class UpsTokenCache {
  private token: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly config: UpsIntegrationConfig,
    private readonly http: HttpClient,
  ) {}

  async get(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAtMs) {
      return this.token.value;
    }
    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  invalidate(): void {
    this.token = null;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret, oauthTokenUrl, requestTimeoutMs, tokenSkewMs } =
      this.config;
    const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString(
      "base64",
    );

    const { status, text } = await this.http.request({
      method: "POST",
      url: oauthTokenUrl,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "x-merchant-id": clientId,
      },
      body: "grant_type=client_credentials",
      timeoutMs: requestTimeoutMs,
    });

    if (!isSuccessStatus(status)) {
      throw authError(
        "UPS OAuth token request failed",
        status,
        bodyForDiagnostics(text),
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch (e) {
      throw parseError(
        "OAuth response was not valid JSON",
        e,
        text.slice(0, OAUTH_SNIPPET_LIMIT),
      );
    }

    const result = oauthTokenResponseSchema.safeParse(raw);
    if (!result.success) {
      throw result.error instanceof ZodError
        ? fromZodError(result.error)
        : parseError("Unexpected OAuth token response");
    }

    this.token = {
      value: result.data.access_token,
      expiresAtMs:
        Date.now() + result.data.expires_in * MS_PER_SECOND - tokenSkewMs,
    };
    return this.token.value;
  }
}
