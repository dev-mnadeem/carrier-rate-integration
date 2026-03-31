import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RateRequest, UpsIntegrationConfig } from "../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(here, "..", "fixtures", name), "utf8"),
  ) as unknown;
}

export const noRetry = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

export const sampleRequest: RateRequest = {
  origin: {
    lines: ["123 Ship Street"],
    city: "TIMONIUM",
    stateProvinceCode: "MD",
    postalCode: "21093",
    countryCode: "US",
  },
  destination: {
    name: "Recipient",
    lines: ["456 Deliver Lane"],
    city: "Alpharetta",
    stateProvinceCode: "GA",
    postalCode: "30005",
    countryCode: "US",
  },
  shipper: { name: "Acme Inc", accountNumber: "SHIPPER01" },
  packages: [
    {
      packagingTypeCode: "02",
      weight: { value: 1, unit: "LBS" },
      dimensions: { length: 5, width: 5, height: 5, unit: "IN" },
    },
  ],
};

export function upsConfig(
  overrides: Partial<UpsIntegrationConfig> = {},
): UpsIntegrationConfig {
  return {
    apiBaseUrl: "https://wwwcie.ups.com/api",
    oauthTokenUrl: "https://wwwcie.ups.com/security/v1/oauth/token",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    accountNumber: "ACC123",
    ratingVersion: "v2409",
    requestTimeoutMs: 10_000,
    tokenSkewMs: 60_000,
    retry: noRetry,
    ...overrides,
  };
}
