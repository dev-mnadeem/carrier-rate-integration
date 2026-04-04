import { CarrierError, isCarrierError, type CarrierErrorKind } from "../errors.js";
import { safeJsonParse } from "../json.js";
import type { RatingCarrier } from "../rating-carrier.js";
import { availableCarrierIds } from "../registry.js";
import { cheapestQuote } from "../schemas/domain.js";

export const MAX_BODY_BYTES = 256 * 1024;

export type ApiRequest = {
  method: string;
  path: string;
  body: string;
};

export type ApiResponse = {
  status: number;
  body: unknown;
};

/**
 * Failure kind to HTTP status. Only `validation` is the client's fault; the
 * rest describe something that went wrong between us and the carrier, which is
 * why they are 5xx even though the carrier itself answered 4xx.
 */
const STATUS_BY_KIND: Record<CarrierErrorKind, number> = {
  validation: 400,
  rate_limit: 429,
  auth: 502,
  upstream: 502,
  parse: 502,
  timeout: 504,
  config: 500,
};

/**
 * The whole HTTP surface as a pure function: no sockets, no framework, so the
 * routing and the error mapping are testable without binding a port.
 */
export async function handle(
  carrier: RatingCarrier,
  req: ApiRequest,
): Promise<ApiResponse> {
  if (req.path === "/healthz") {
    return requireMethod(req, "GET", () => ({
      status: 200,
      body: { status: "ok", carrier: carrier.id },
    }));
  }

  if (req.path === "/v1/carriers") {
    return requireMethod(req, "GET", () => ({
      status: 200,
      body: { active: carrier.id, available: availableCarrierIds() },
    }));
  }

  if (req.path === "/v1/rates") {
    return requireMethod(req, "POST", () => postRates(carrier, req.body));
  }

  return errorBody(404, "NOT_FOUND", `No route for ${req.method} ${req.path}`);
}

async function postRates(
  carrier: RatingCarrier,
  rawBody: string,
): Promise<ApiResponse> {
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorBody(413, "BODY_TOO_LARGE", "Rate request body is too large");
  }

  const payload = safeJsonParse(rawBody);
  if (payload === undefined) {
    return errorBody(400, "INVALID_JSON", "Request body is not valid JSON");
  }

  try {
    const quotes = await carrier.getRates(payload);
    return {
      status: 200,
      body: {
        carrierId: carrier.id,
        count: quotes.length,
        cheapest: cheapestQuote(quotes) ?? null,
        quotes,
      },
    };
  } catch (e) {
    return toErrorResponse(e);
  }
}

export function toErrorResponse(e: unknown): ApiResponse {
  if (isCarrierError(e)) {
    return { status: STATUS_BY_KIND[e.kind], body: { error: e.toJSON() } };
  }
  // Never leak an unexpected stack to the client.
  return errorBody(500, "INTERNAL_ERROR", "Unexpected server error");
}

async function requireMethod(
  req: ApiRequest,
  method: string,
  handler: () => ApiResponse | Promise<ApiResponse>,
): Promise<ApiResponse> {
  if (req.method !== method) {
    return errorBody(
      405,
      "METHOD_NOT_ALLOWED",
      `${req.path} accepts ${method} only`,
    );
  }
  return handler();
}

function errorBody(status: number, code: string, message: string): ApiResponse {
  return {
    status,
    body: {
      error: new CarrierError({
        kind: status >= 500 ? "upstream" : "validation",
        code,
        message,
      }).toJSON(),
    },
  };
}
