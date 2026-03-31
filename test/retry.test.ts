import { describe, expect, it, vi } from "vitest";
import {
  computeDelayMs,
  defaultRetryPolicy,
  isRetryableStatus,
  parseRetryAfterMs,
} from "../src/retry.js";

describe("retry policy", () => {
  it("retries only the statuses a retry could plausibly fix", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });

  it("backs off exponentially and clamps at the ceiling", () => {
    const policy = { maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 500 };
    expect(computeDelayMs(1, policy)).toBe(100);
    expect(computeDelayMs(2, policy)).toBe(200);
    expect(computeDelayMs(3, policy)).toBe(400);
    expect(computeDelayMs(4, policy)).toBe(500);
    expect(computeDelayMs(9, policy)).toBe(500);
  });

  it("prefers Retry-After in delta-seconds over the computed backoff", () => {
    const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000 };
    expect(computeDelayMs(1, policy, "3")).toBe(3000);
  });

  it("still clamps a Retry-After that exceeds the ceiling", () => {
    const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000 };
    expect(computeDelayMs(1, policy, "600")).toBe(2000);
  });

  it("reads the HTTP-date form of Retry-After", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2024-01-01T00:00:00.000Z"));
    expect(parseRetryAfterMs("Mon, 01 Jan 2024 00:00:05 GMT")).toBe(5000);
    vi.useRealTimers();
  });

  it("ignores an unparseable Retry-After", () => {
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it("ships a default policy that actually retries", () => {
    expect(defaultRetryPolicy.maxAttempts).toBeGreaterThan(1);
  });
});
