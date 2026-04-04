export {
  DEFAULT_RATING_VERSION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SERVER_PORT,
  DEFAULT_TOKEN_SKEW_MS,
  loadAppConfig,
  loadUpsConfig,
  type AppConfig,
  type AppEnv,
  type UpsIntegrationConfig,
} from "./config.js";
export {
  CarrierError,
  authError,
  configError,
  fromZodError,
  isCarrierError,
  networkError,
  parseError,
  rateLimitError,
  timeoutError,
  upstreamError,
  validationError,
  type CarrierErrorKind,
} from "./errors.js";
export {
  HttpClient,
  isSuccessStatus,
  type FetchFn,
  type HttpClientOptions,
  type HttpRequest,
  type HttpResponse,
} from "./http-client.js";
export { bodyForDiagnostics, safeJsonParse } from "./json.js";
export {
  computeDelayMs,
  defaultRetryPolicy,
  isRetryableStatus,
  parseRetryAfterMs,
  type RetryPolicy,
  type SleepFn,
} from "./retry.js";
export {
  BaseRatingCarrier,
  validateRateRequest,
  type RatingCarrier,
} from "./rating-carrier.js";
export {
  availableCarrierIds,
  createCarrier,
  registerCarrier,
  type CarrierFactory,
  type CarrierFactoryContext,
} from "./registry.js";
export {
  cheapestQuote,
  parseRateRequest,
  rateQuoteSchema,
  rateRequestSchema,
  type Address,
  type DimensionUnit,
  type RateQuote,
  type RateRequest,
  type ShipmentPackage,
  type Shipper,
  type WeightUnit,
} from "./schemas/index.js";
export {
  FAKE_CARRIER_ID,
  FakeRatingCarrier,
  billableWeightLbsFor,
  zoneFor,
} from "./fake/index.js";
export {
  UPS_CARRIER_ID,
  UpsRatingCarrier,
  UpsTokenCache,
  buildUpsShopRequest,
  mapRateResponseToQuotes,
  resolveAccountNumber,
} from "./ups/index.js";
export { createRatingServer, handle, listen } from "./server/index.js";

import {
  loadAppConfig,
  loadUpsConfig,
  type UpsIntegrationConfig,
} from "./config.js";
import { FakeRatingCarrier } from "./fake/index.js";
import type { RatingCarrier } from "./rating-carrier.js";
import { createCarrier } from "./registry.js";
import { UpsRatingCarrier, type UpsRatingCarrierOptions } from "./ups/carrier.js";

export type { UpsRatingCarrierOptions };

export function createUpsRatingCarrier(
  config: UpsIntegrationConfig,
  options: UpsRatingCarrierOptions = {},
): RatingCarrier {
  return new UpsRatingCarrier(config, options);
}

export function createFakeRatingCarrier(): RatingCarrier {
  return new FakeRatingCarrier();
}

export function createUpsRatingCarrierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: UpsRatingCarrierOptions = {},
): RatingCarrier {
  const app = loadAppConfig(env);
  return new UpsRatingCarrier(loadUpsConfig(env, app), options);
}

/** Builds whichever carrier `CARRIER_ID` names. */
export function createCarrierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RatingCarrier {
  return createCarrier({ app: loadAppConfig(env), env });
}
