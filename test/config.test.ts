import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_PORT,
  loadAppConfig,
  loadUpsConfig,
} from "../src/config.js";

const upsEnv = {
  UPS_API_BASE_URL: "https://wwwcie.ups.com/api/",
  UPS_OAUTH_TOKEN_URL: "https://wwwcie.ups.com/security/v1/oauth/token",
  UPS_CLIENT_ID: "id",
  UPS_CLIENT_SECRET: "secret",
};

describe("configuration", () => {
  it("falls back to documented defaults when nothing is set", () => {
    const config = loadAppConfig({});
    expect(config.carrierId).toBe("ups");
    expect(config.port).toBe(DEFAULT_SERVER_PORT);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.retry.maxAttempts).toBe(3);
  });

  it("normalises the carrier id", () => {
    expect(loadAppConfig({ CARRIER_ID: "  FAKE " }).carrierId).toBe("fake");
  });

  it("treats a blank value as unset instead of failing coercion", () => {
    expect(loadAppConfig({ PORT: "" }).port).toBe(DEFAULT_SERVER_PORT);
  });

  it("rejects a port outside the valid range", () => {
    expect(() => loadAppConfig({ PORT: "70000" })).toThrowError(
      /Invalid application configuration/,
    );
  });

  it("builds a UPS config and strips the trailing slash from the base URL", () => {
    const config = loadUpsConfig(upsEnv);
    expect(config.apiBaseUrl).toBe("https://wwwcie.ups.com/api");
    expect(config.ratingVersion).toBe("v2409");
    expect(config.accountNumber).toBe("");
  });

  it("reports missing UPS credentials as a config error", () => {
    try {
      loadUpsConfig({});
      expect.unreachable("expected a config error");
    } catch (e) {
      expect(e).toMatchObject({ kind: "config", code: "CONFIG_ERROR" });
    }
  });

  it("does not require UPS credentials to load the application config", () => {
    expect(() => loadAppConfig({ CARRIER_ID: "fake" })).not.toThrow();
  });

  it("carries retry settings through to the UPS config", () => {
    const config = loadUpsConfig({
      ...upsEnv,
      MAX_RETRY_ATTEMPTS: "5",
      RETRY_BASE_DELAY_MS: "10",
      RETRY_MAX_DELAY_MS: "20",
    });
    expect(config.retry).toEqual({
      maxAttempts: 5,
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
  });
});
