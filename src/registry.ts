import { loadUpsConfig, type AppConfig } from "./config.js";
import { configError } from "./errors.js";
import { FAKE_CARRIER_ID, FakeRatingCarrier } from "./fake/index.js";
import type { FetchFn } from "./http-client.js";
import type { RatingCarrier } from "./rating-carrier.js";
import { UPS_CARRIER_ID, UpsRatingCarrier } from "./ups/index.js";

export type CarrierFactoryContext = {
  app: AppConfig;
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchFn;
};

export type CarrierFactory = (context: CarrierFactoryContext) => RatingCarrier;

/**
 * Carrier id to factory. A new carrier is registered here and selected with
 * `CARRIER_ID`; nothing else in the codebase learns its name.
 */
const registry = new Map<string, CarrierFactory>([
  [
    UPS_CARRIER_ID,
    ({ app, env, fetchImpl }) =>
      new UpsRatingCarrier(loadUpsConfig(env, app), { fetchImpl }),
  ],
  [FAKE_CARRIER_ID, () => new FakeRatingCarrier()],
]);

export function registerCarrier(id: string, factory: CarrierFactory): void {
  registry.set(id, factory);
}

export function availableCarrierIds(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Builds the carrier named by `app.carrierId`. Credentials for a carrier are
 * only read when that carrier is the one being built.
 */
export function createCarrier(context: CarrierFactoryContext): RatingCarrier {
  const factory = registry.get(context.app.carrierId);
  if (!factory) {
    throw configError(`Unknown carrier "${context.app.carrierId}"`, {
      available: availableCarrierIds(),
    });
  }
  return factory(context);
}
