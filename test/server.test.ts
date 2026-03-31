import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeRatingCarrier } from "../src/fake/index.js";
import { BaseRatingCarrier } from "../src/rating-carrier.js";
import { timeoutError, upstreamError, rateLimitError } from "../src/errors.js";
import { handle } from "../src/server/app.js";
import { createRatingServer, listen } from "../src/server/http-server.js";
import { sampleRequest } from "./support/fixtures.js";

const carrier = new FakeRatingCarrier();

function get(path: string) {
  return handle(carrier, { method: "GET", path, body: "" });
}

function post(path: string, body: unknown) {
  return handle(carrier, { method: "POST", path, body: JSON.stringify(body) });
}

class FailingCarrier extends BaseRatingCarrier {
  readonly id = "failing";
  constructor(private readonly failure: Error) {
    super();
  }
  protected quote(): Promise<never> {
    return Promise.reject(this.failure);
  }
}

describe("HTTP facade (pure handler)", () => {
  it("answers the health check with the active carrier", async () => {
    await expect(get("/healthz")).resolves.toEqual({
      status: 200,
      body: { status: "ok", carrier: "fake" },
    });
  });

  it("lists the active and available carriers", async () => {
    const res = await get("/v1/carriers");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: "fake" });
    expect((res.body as { available: string[] }).available).toContain("ups");
  });

  it("returns quotes plus the cheapest one", async () => {
    const res = await post("/v1/rates", sampleRequest);
    expect(res.status).toBe(200);
    const body = res.body as {
      carrierId: string;
      count: number;
      cheapest: { serviceCode: string };
      quotes: unknown[];
    };
    expect(body.carrierId).toBe("fake");
    expect(body.count).toBe(3);
    expect(body.quotes).toHaveLength(3);
    expect(body.cheapest.serviceCode).toBe("03");
  });

  it("rejects an invalid rate request with 400 and field details", async () => {
    const res = await post("/v1/rates", { origin: {} });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { kind: "validation", code: "VALIDATION_ERROR" },
    });
  });

  it("rejects a body that is not JSON", async () => {
    const res = await handle(carrier, {
      method: "POST",
      path: "/v1/rates",
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it("refuses the wrong method on a known route", async () => {
    const res = await handle(carrier, {
      method: "GET",
      path: "/v1/rates",
      body: "",
    });
    expect(res.status).toBe(405);
    expect(res.body).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });

  it("404s an unknown route", async () => {
    const res = await get("/v1/labels");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it.each([
    [timeoutError(), 504],
    [rateLimitError("slow down", 429), 429],
    [upstreamError("boom", 500), 502],
  ])("maps carrier failures onto HTTP status codes", async (failure, status) => {
    const res = await handle(new FailingCarrier(failure), {
      method: "POST",
      path: "/v1/rates",
      body: JSON.stringify(sampleRequest),
    });
    expect(res.status).toBe(status);
  });

  it("hides an unexpected non-carrier failure behind a generic 500", async () => {
    const res = await handle(new FailingCarrier(new Error("secret internals")), {
      method: "POST",
      path: "/v1/rates",
      body: JSON.stringify(sampleRequest),
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret internals");
  });
});

describe("HTTP facade (real socket)", () => {
  const server = createRatingServer(carrier);
  let origin = "";

  beforeAll(async () => {
    await listen(server, { host: "127.0.0.1", port: 7121 });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the health check over a real connection", async () => {
    const res = await fetch(`${origin}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      carrier: "fake",
    });
  });

  it("rates a shipment over a real connection", async () => {
    const res = await fetch(`${origin}/v1/rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleRequest),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(3);
  });
});
