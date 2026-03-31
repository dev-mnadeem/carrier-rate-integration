import { describe, expect, it } from "vitest";
import { HttpClient, type FetchFn } from "../src/http-client.js";
import { isCarrierError, type CarrierError } from "../src/errors.js";

const request = {
  method: "GET",
  url: "https://carrier.example/rates",
  timeoutMs: 1000,
};

function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe("HttpClient retry behaviour", () => {
  it("retries a 503 and returns the eventual success", async () => {
    let calls = 0;
    const fetchImpl: FetchFn = () => {
      calls += 1;
      return Promise.resolve(
        calls < 3 ? new Response("busy", { status: 503 }) : new Response("{}"),
      );
    };
    const { delays, sleep } = recordingSleep();
    const client = new HttpClient(fetchImpl, {
      retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
      sleep,
    });

    const res = await client.request(request);
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it("honours Retry-After on a 429", async () => {
    let calls = 0;
    const fetchImpl: FetchFn = () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? new Response("slow down", {
              status: 429,
              headers: { "Retry-After": "2" },
            })
          : new Response("{}"),
      );
    };
    const { delays, sleep } = recordingSleep();
    const client = new HttpClient(fetchImpl, {
      retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10_000 },
      sleep,
    });

    await client.request(request);
    expect(delays).toEqual([2000]);
  });

  it("does not retry a 400 the carrier will reject identically", async () => {
    let calls = 0;
    const fetchImpl: FetchFn = () => {
      calls += 1;
      return Promise.resolve(new Response("bad", { status: 400 }));
    };
    const client = new HttpClient(fetchImpl, {
      retry: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: () => Promise.resolve(),
    });

    const res = await client.request(request);
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });

  it("retries a network failure and surfaces the last one when the budget runs out", async () => {
    let calls = 0;
    const fetchImpl: FetchFn = () => {
      calls += 1;
      return Promise.reject(new Error("ECONNRESET"));
    };
    const client = new HttpClient(fetchImpl, {
      retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: () => Promise.resolve(),
    });

    await expect(client.request(request)).rejects.toMatchObject({
      kind: "upstream",
      code: "NETWORK_ERROR",
    });
    expect(calls).toBe(3);
  });

  it("returns the final retryable response rather than throwing", async () => {
    const fetchImpl: FetchFn = () =>
      Promise.resolve(new Response("still busy", { status: 503 }));
    const client = new HttpClient(fetchImpl, {
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: () => Promise.resolve(),
    });

    const res = await client.request(request);
    expect(res.status).toBe(503);
  });

  it("lower-cases response header names", async () => {
    const fetchImpl: FetchFn = () =>
      Promise.resolve(new Response("{}", { headers: { "X-Trace-Id": "abc123" } }));
    const client = new HttpClient(fetchImpl);
    const res = await client.request(request);
    expect(res.headers["x-trace-id"]).toBe("abc123");
  });

  it("reports a malformed JSON body as a parse error", async () => {
    const fetchImpl: FetchFn = () => Promise.resolve(new Response("{oops"));
    const client = new HttpClient(fetchImpl);
    try {
      await client.requestJson(request);
      expect.unreachable("expected a parse error");
    } catch (e) {
      expect(isCarrierError(e)).toBe(true);
      expect((e as CarrierError).kind).toBe("parse");
    }
  });

  it("decodes an empty body as null rather than failing", () => {
    const client = new HttpClient(() => Promise.resolve(new Response("")));
    expect(client.decode("")).toBeNull();
  });
});
