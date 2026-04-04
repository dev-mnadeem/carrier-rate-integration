import type { UpsIntegrationConfig } from "../config.js";
import { authError, parseError, rateLimitError, upstreamError } from "../errors.js";
import {
  HttpClient,
  isSuccessStatus,
  type FetchFn,
  type HttpClientOptions,
} from "../http-client.js";
import { bodyForDiagnostics } from "../json.js";
import { BaseRatingCarrier } from "../rating-carrier.js";
import type { RateQuote, RateRequest } from "../schemas/domain.js";
import {
  UPS_CARRIER_ID,
  TRANSACTION_SOURCE,
  buildUpsShopRequest,
  mapRateResponseToQuotes,
  randomTransId,
} from "./helpers.js";
import { UpsTokenCache } from "./token-cache.js";

const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;
const RATING_SNIPPET_LIMIT = 500;

export type UpsRatingCarrierOptions = HttpClientOptions & {
  fetchImpl?: FetchFn;
};

/**
 * UPS Rating "Shop" adapter: OAuth client credentials for auth, one POST per
 * rate request, UPS field names translated to domain types on the way out.
 */
export class UpsRatingCarrier extends BaseRatingCarrier {
  readonly id = UPS_CARRIER_ID;

  private readonly http: HttpClient;
  private readonly tokens: UpsTokenCache;

  constructor(
    private readonly config: UpsIntegrationConfig,
    options: UpsRatingCarrierOptions = {},
  ) {
    super();
    const { fetchImpl, ...httpOptions } = options;
    this.http = new HttpClient(fetchImpl ?? globalThis.fetch, {
      retry: config.retry,
      ...httpOptions,
    });
    this.tokens = new UpsTokenCache(config, this.http);
  }

  /** Drops the cached access token so the next call re-authenticates. */
  invalidateToken(): void {
    this.tokens.invalidate();
  }

  protected async quote(request: RateRequest): Promise<RateQuote[]> {
    const body = JSON.stringify(
      buildUpsShopRequest(request, this.config.accountNumber),
    );
    const accessToken = await this.tokens.get();
    return mapRateResponseToQuotes(await this.postShop(accessToken, body, false));
  }

  private get shopUrl(): string {
    return `${this.config.apiBaseUrl}/rating/${this.config.ratingVersion}/shop`;
  }

  private async postShop(
    accessToken: string,
    body: string,
    isRetry: boolean,
  ): Promise<unknown> {
    const { status, text } = await this.http.request({
      method: "POST",
      url: this.shopUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        transId: randomTransId(),
        transactionSrc: TRANSACTION_SOURCE,
      },
      body,
      timeoutMs: this.config.requestTimeoutMs,
    });

    // A token can be revoked mid-flight, so one 401 earns one fresh token.
    if (status === HTTP_UNAUTHORIZED && !isRetry) {
      this.tokens.invalidate();
      return this.postShop(await this.tokens.get(), body, true);
    }

    if (!isSuccessStatus(status)) {
      throw this.toCarrierError(status, text);
    }

    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      throw parseError(
        "UPS Rating returned non-JSON body",
        e,
        text.slice(0, RATING_SNIPPET_LIMIT),
      );
    }
  }

  private toCarrierError(status: number, text: string) {
    const details = bodyForDiagnostics(text);
    if (status === HTTP_UNAUTHORIZED) {
      return authError("Unauthorized calling UPS Rating", status, details);
    }
    if (status === HTTP_TOO_MANY_REQUESTS) {
      return rateLimitError(
        "UPS Rating rate limit not cleared within the retry budget",
        status,
        details,
      );
    }
    return upstreamError(
      `UPS Rating request failed with HTTP ${status}`,
      status,
      details,
    );
  }
}
