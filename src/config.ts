import { z } from "zod";
import { configError, fromZodError } from "./errors.js";
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  type RetryPolicy,
} from "./retry.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_TOKEN_SKEW_MS = 60_000;
export const DEFAULT_SERVER_PORT = 7121;
export const DEFAULT_RATING_VERSION = "v2409";

/**
 * Settings every carrier needs. UPS credentials are deliberately absent so the
 * process can boot — and the test suite and the fake carrier can run — with no
 * UPS account configured at all.
 */
const baseSchema = z.object({
  CARRIER_ID: z.string().min(1).default("ups"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65_535).default(DEFAULT_SERVER_PORT),
  REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_REQUEST_TIMEOUT_MS),
  TOKEN_SKEW_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_TOKEN_SKEW_MS),
  MAX_RETRY_ATTEMPTS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_ATTEMPTS),
  RETRY_BASE_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_BASE_DELAY_MS),
  RETRY_MAX_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(DEFAULT_MAX_DELAY_MS),
});

const upsSchema = z.object({
  UPS_API_BASE_URL: z.string().url(),
  UPS_OAUTH_TOKEN_URL: z.string().url(),
  UPS_CLIENT_ID: z.string().min(1),
  UPS_CLIENT_SECRET: z.string().min(1),
  UPS_ACCOUNT_NUMBER: z.string().optional().default(""),
  UPS_RATING_VERSION: z.string().min(1).default(DEFAULT_RATING_VERSION),
});

export type AppEnv = z.infer<typeof baseSchema>;

export type AppConfig = {
  carrierId: string;
  host: string;
  port: number;
  requestTimeoutMs: number;
  tokenSkewMs: number;
  retry: RetryPolicy;
};

export type UpsIntegrationConfig = {
  apiBaseUrl: string;
  oauthTokenUrl: string;
  clientId: string;
  clientSecret: string;
  accountNumber: string;
  ratingVersion: string;
  requestTimeoutMs: number;
  tokenSkewMs: number;
  retry: RetryPolicy;
};

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = parseOrThrow(baseSchema, env, "application");
  return {
    carrierId: parsed.CARRIER_ID.trim().toLowerCase(),
    host: parsed.HOST,
    port: parsed.PORT,
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    tokenSkewMs: parsed.TOKEN_SKEW_MS,
    retry: {
      maxAttempts: parsed.MAX_RETRY_ATTEMPTS,
      baseDelayMs: parsed.RETRY_BASE_DELAY_MS,
      maxDelayMs: parsed.RETRY_MAX_DELAY_MS,
    },
  };
}

/**
 * Reads UPS credentials. Called only when the UPS carrier is actually
 * selected, so a `CARRIER_ID=fake` deployment never needs a UPS account.
 */
export function loadUpsConfig(
  env: NodeJS.ProcessEnv = process.env,
  app: AppConfig = loadAppConfig(env),
): UpsIntegrationConfig {
  const parsed = parseOrThrow(upsSchema, env, "UPS");
  return {
    apiBaseUrl: stripTrailingSlash(parsed.UPS_API_BASE_URL),
    oauthTokenUrl: parsed.UPS_OAUTH_TOKEN_URL,
    clientId: parsed.UPS_CLIENT_ID,
    clientSecret: parsed.UPS_CLIENT_SECRET,
    accountNumber: parsed.UPS_ACCOUNT_NUMBER,
    ratingVersion: parsed.UPS_RATING_VERSION,
    requestTimeoutMs: app.requestTimeoutMs,
    tokenSkewMs: app.tokenSkewMs,
    retry: app.retry,
  };
}

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  env: NodeJS.ProcessEnv,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(withoutBlanks(env));
  if (result.success) return result.data as z.infer<T>;
  throw configError(
    `Invalid ${label} configuration`,
    fromZodError(result.error).details,
  );
}

/**
 * Treats `FOO=` in a .env file or compose file the same as "not set", so a
 * blank line does not become a coercion failure on a field that has a default.
 */
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
