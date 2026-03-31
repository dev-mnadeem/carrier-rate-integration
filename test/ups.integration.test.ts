import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  type CarrierError,
  createUpsRatingCarrier,
  isCarrierError,
  type FetchFn,
  type UpsIntegrationConfig,
} from "../src/index.js";

/** Most cases assert single-shot behaviour, so retrying is off by default. */
const noRetry = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  const path = join(__dirname, "fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const tokenFixture = loadFixture("ups-token-response.json") as Record<
  string,
  unknown
>;
const ratingSuccessFixture = loadFixture("ups-rating-success.json");

const sampleRequest = {
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
      weight: { value: 1, unit: "LBS" as const },
      dimensions: {
        length: 5,
        width: 5,
        height: 5,
        unit: "IN" as const,
      },
    },
  ],
};

function baseConfig(
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

describe("UpsRatingCarrier integration (stubbed HTTP)", () => {
  it("builds a Shop request, obtains OAuth token, and normalizes rated shipments", async () => {
    const ratingBodies: string[] = [];
    let oauthCalls = 0;
    const fetchMock: FetchFn = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/security/v1/oauth/token")) {
        oauthCalls += 1;
        return new Response(JSON.stringify(tokenFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/rating/v2409/shop")) {
        expect(init?.headers).toBeDefined();
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toMatch(/^Bearer /);
        ratingBodies.push(typeof init?.body === "string" ? init.body : "");
        return new Response(JSON.stringify(ratingSuccessFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    const quotes = await carrier.getRates(sampleRequest);

    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({
      carrierId: "ups",
      serviceCode: "03",
      serviceName: "Ground",
      totalPrice: "12.34",
      currencyCode: "USD",
      billingWeight: "2",
    });
    expect(quotes[1]?.serviceCode).toBe("02");

    expect(oauthCalls).toBe(1);

    const body = JSON.parse(ratingBodies[0]) as {
      RateRequest: { Request: { RequestOption: string }; Shipment: unknown };
    };
    expect(body.RateRequest.Request.RequestOption).toBe("Shop");
    expect(body.RateRequest.Shipment).toMatchObject({
      NumOfPieces: "1",
      Shipper: expect.objectContaining({ Name: "Acme Inc" }),
    });
  });

  it("reuses a cached token for subsequent rate calls", async () => {
    let oauthCalls = 0;
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/security/v1/oauth/token")) {
        oauthCalls += 1;
        return new Response(JSON.stringify(tokenFixture), { status: 200 });
      }
      if (url.includes("/rating/")) {
        return new Response(JSON.stringify(ratingSuccessFixture), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    };

    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    await carrier.getRates(sampleRequest);
    await carrier.getRates(sampleRequest);
    expect(oauthCalls).toBe(1);
  });

  it("refreshes the token after cached expiry", async () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2024-01-01T00:00:00.000Z");
    vi.setSystemTime(t0);

    let oauthCalls = 0;
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/security/v1/oauth/token")) {
        oauthCalls += 1;
        return new Response(JSON.stringify(tokenFixture), { status: 200 });
      }
      if (url.includes("/rating/")) {
        return new Response(JSON.stringify(ratingSuccessFixture), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    };

    const carrier = createUpsRatingCarrier(baseConfig({ tokenSkewMs: 60_000 }), {
      fetchImpl: fetchMock,
    });
    await carrier.getRates(sampleRequest);
    expect(oauthCalls).toBe(1);

    const expiresInMs = 3600 * 1000 - 60_000;
    vi.setSystemTime(t0 + expiresInMs + 1);
    await carrier.getRates(sampleRequest);
    expect(oauthCalls).toBe(2);

    vi.useRealTimers();
  });

  it("retries rating once after HTTP 401 by refreshing the token", async () => {
    let oauthCalls = 0;
    let ratingCalls = 0;
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/security/v1/oauth/token")) {
        oauthCalls += 1;
        return new Response(JSON.stringify(tokenFixture), { status: 200 });
      }
      if (url.includes("/rating/")) {
        ratingCalls += 1;
        if (ratingCalls === 1) {
          return new Response(JSON.stringify({ reason: "stale" }), {
            status: 401,
          });
        }
        return new Response(JSON.stringify(ratingSuccessFixture), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    };

    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    const quotes = await carrier.getRates(sampleRequest);
    expect(quotes.length).toBeGreaterThan(0);
    expect(oauthCalls).toBe(2);
    expect(ratingCalls).toBe(2);
  });

  it("maps validation failures to CarrierError", async () => {
    const fetchMock: FetchFn = async () =>
      new Response(JSON.stringify(ratingSuccessFixture), { status: 200 });
    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    try {
      await carrier.getRates({});
      expect.fail("expected rejection");
    } catch (e) {
      expect(isCarrierError(e)).toBe(true);
      expect((e as CarrierError).kind).toBe("validation");
    }
  });

  it("maps upstream HTTP errors to structured CarrierError", async () => {
    const errBody = loadFixture("ups-rating-error.json");
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify(tokenFixture), { status: 200 });
      }
      return new Response(JSON.stringify(errBody), { status: 400 });
    };
    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    await expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
      kind: "upstream",
      httpStatus: 400,
    });
  });

  it("maps malformed JSON bodies to parse errors", async () => {
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify(tokenFixture), { status: 200 });
      }
      return new Response("not-json-{", { status: 200 });
    };
    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    await expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
      kind: "parse",
    });
  });

  it("maps OAuth failures to auth errors", async () => {
    const fetchMock: FetchFn = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/oauth/token")) {
        return new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
        });
      }
      return new Response("nope", { status: 404 });
    };
    const carrier = createUpsRatingCarrier(baseConfig(), { fetchImpl: fetchMock });
    await expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
      kind: "auth",
      httpStatus: 401,
    });
  });

  it("maps request timeouts to timeout errors", async () => {
    vi.useFakeTimers();
    const fetchMock: FetchFn = (_input, init) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("expected AbortSignal"));
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

    const carrier = createUpsRatingCarrier(baseConfig({ requestTimeoutMs: 50 }), {
      fetchImpl: fetchMock,
    });

    await Promise.all([
      expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
        kind: "timeout",
      }),
      vi.advanceTimersByTimeAsync(200),
    ]);

    vi.useRealTimers();
  });
});

describe("UpsRatingCarrier resilience", () => {
  const tokenResponse = () =>
    new Response(JSON.stringify(tokenFixture), { status: 200 });
  const ratingResponse = () =>
    new Response(JSON.stringify(ratingSuccessFixture), { status: 200 });

  function urlOf(input: Parameters<FetchFn>[0]): string {
    if (typeof input === "string") return input;
    return input instanceof URL ? input.href : input.url;
  }

  it("issues one OAuth request for concurrent cold-start rate calls", async () => {
    let oauthCalls = 0;
    const fetchMock: FetchFn = async (input) => {
      const url = urlOf(input);
      if (url.includes("/oauth/token")) {
        oauthCalls += 1;
        // Yield so both callers reach the cache before either resolves.
        await Promise.resolve();
        return tokenResponse();
      }
      return ratingResponse();
    };

    const carrier = createUpsRatingCarrier(baseConfig(), {
      fetchImpl: fetchMock,
    });
    await Promise.all([
      carrier.getRates(sampleRequest),
      carrier.getRates(sampleRequest),
      carrier.getRates(sampleRequest),
    ]);

    expect(oauthCalls).toBe(1);
  });

  it("retries a 503 from the rating endpoint and succeeds", async () => {
    let ratingCalls = 0;
    const fetchMock: FetchFn = (input) => {
      const url = urlOf(input);
      if (url.includes("/oauth/token")) return Promise.resolve(tokenResponse());
      ratingCalls += 1;
      return Promise.resolve(
        ratingCalls === 1
          ? new Response("upstream busy", { status: 503 })
          : ratingResponse(),
      );
    };

    const carrier = createUpsRatingCarrier(
      baseConfig({ retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 } }),
      { fetchImpl: fetchMock, sleep: () => Promise.resolve() },
    );

    await expect(carrier.getRates(sampleRequest)).resolves.toHaveLength(2);
    expect(ratingCalls).toBe(2);
  });

  it("surfaces a rate_limit error once the retry budget is spent", async () => {
    let ratingCalls = 0;
    const fetchMock: FetchFn = (input) => {
      const url = urlOf(input);
      if (url.includes("/oauth/token")) return Promise.resolve(tokenResponse());
      ratingCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: "too many requests" }), {
          status: 429,
          headers: { "Retry-After": "1" },
        }),
      );
    };

    const carrier = createUpsRatingCarrier(
      baseConfig({ retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 } }),
      { fetchImpl: fetchMock, sleep: () => Promise.resolve() },
    );

    await expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
      kind: "rate_limit",
      code: "RATE_LIMITED",
      httpStatus: 429,
    });
    expect(ratingCalls).toBe(2);
  });

  it("rejects a non-numeric expires_in rather than caching a NaN expiry", async () => {
    const fetchMock: FetchFn = (input) =>
      Promise.resolve(
        urlOf(input).includes("/oauth/token")
          ? new Response(JSON.stringify({ ...tokenFixture, expires_in: "soon" }), {
              status: 200,
            })
          : ratingResponse(),
      );

    const carrier = createUpsRatingCarrier(baseConfig(), {
      fetchImpl: fetchMock,
    });
    await expect(carrier.getRates(sampleRequest)).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("carries the configured account number into the billed shipment", async () => {
    const bodies: string[] = [];
    const fetchMock: FetchFn = (input, init) => {
      const url = urlOf(input);
      if (url.includes("/oauth/token")) return Promise.resolve(tokenResponse());
      bodies.push(typeof init?.body === "string" ? init.body : "");
      return Promise.resolve(ratingResponse());
    };

    const carrier = createUpsRatingCarrier(
      baseConfig({ accountNumber: "ENVACCT" }),
      { fetchImpl: fetchMock },
    );
    await carrier.getRates({
      ...sampleRequest,
      shipper: { name: "Acme Inc", accountNumber: "" },
    });

    const body = JSON.parse(bodies[0]) as {
      RateRequest: { Shipment: { Shipper: { ShipperNumber?: string } } };
    };
    expect(body.RateRequest.Shipment.Shipper.ShipperNumber).toBe("ENVACCT");
  });

  it("exposes a stable carrier id used on every quote", async () => {
    const fetchMock: FetchFn = (input) =>
      Promise.resolve(
        urlOf(input).includes("/oauth/token") ? tokenResponse() : ratingResponse(),
      );
    const carrier = createUpsRatingCarrier(baseConfig(), {
      fetchImpl: fetchMock,
    });
    expect(carrier.id).toBe("ups");
    const quotes = await carrier.getRates(sampleRequest);
    expect(quotes.every((q) => q.carrierId === "ups")).toBe(true);
  });
});
