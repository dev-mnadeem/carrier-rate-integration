import { describe, expect, it } from "vitest";
import { loadAppConfig } from "../src/config.js";
import {
  availableCarrierIds,
  createCarrier,
  registerCarrier,
} from "../src/registry.js";
import { BaseRatingCarrier } from "../src/rating-carrier.js";
import type { RateQuote } from "../src/schemas/domain.js";

describe("carrier registry", () => {
  it("lists the carriers that ship with the package", () => {
    expect(availableCarrierIds()).toContain("ups");
    expect(availableCarrierIds()).toContain("fake");
  });

  it("builds the fake carrier without any UPS credentials present", () => {
    const env = { CARRIER_ID: "fake" };
    const carrier = createCarrier({ app: loadAppConfig(env), env });
    expect(carrier.id).toBe("fake");
  });

  it("builds the UPS carrier when credentials are present", () => {
    const env = {
      CARRIER_ID: "ups",
      UPS_API_BASE_URL: "https://wwwcie.ups.com/api",
      UPS_OAUTH_TOKEN_URL: "https://wwwcie.ups.com/security/v1/oauth/token",
      UPS_CLIENT_ID: "id",
      UPS_CLIENT_SECRET: "secret",
    };
    expect(createCarrier({ app: loadAppConfig(env), env }).id).toBe("ups");
  });

  it("names the available carriers when an unknown one is selected", () => {
    const env = { CARRIER_ID: "royalmail" };
    try {
      createCarrier({ app: loadAppConfig(env), env });
      expect.unreachable("expected a config error");
    } catch (e) {
      expect(e).toMatchObject({ kind: "config" });
      expect(
        (e as { details: { available: string[] } }).details.available,
      ).toContain("ups");
    }
  });

  it("accepts a third-party carrier registered at runtime", async () => {
    class StubCarrier extends BaseRatingCarrier {
      readonly id = "stub";
      protected quote(): Promise<RateQuote[]> {
        return Promise.resolve([
          {
            carrierId: "stub",
            serviceCode: "XX",
            totalPrice: "1.00",
            currencyCode: "GBP",
          },
        ]);
      }
    }
    registerCarrier("stub", () => new StubCarrier());

    const env = { CARRIER_ID: "stub" };
    const carrier = createCarrier({ app: loadAppConfig(env), env });
    expect(carrier.id).toBe("stub");
    expect(availableCarrierIds()).toContain("stub");
  });
});
