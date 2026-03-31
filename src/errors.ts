import type { ZodError } from "zod";

/**
 * Failure taxonomy. Callers branch on `kind` so they never have to pattern
 * match on an error message, and the HTTP facade maps `kind` to a status code.
 */
export type CarrierErrorKind =
  | "validation"
  | "auth"
  | "upstream"
  | "rate_limit"
  | "timeout"
  | "parse"
  | "config";

export type CarrierErrorOptions = {
  kind: CarrierErrorKind;
  code: string;
  message: string;
  httpStatus?: number;
  details?: unknown;
  cause?: unknown;
};

export class CarrierError extends Error {
  readonly kind: CarrierErrorKind;
  readonly code: string;
  readonly httpStatus?: number;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(opts: CarrierErrorOptions) {
    super(opts.message);
    this.name = "CarrierError";
    this.kind = opts.kind;
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.details = opts.details;
    this.cause = opts.cause;
  }

  /** Shape safe to serialise to an API client: never includes `cause`. */
  toJSON(): {
    kind: CarrierErrorKind;
    code: string;
    message: string;
    details?: unknown;
  } {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function isCarrierError(e: unknown): e is CarrierError {
  return e instanceof CarrierError;
}

export function validationError(
  message: string,
  details?: unknown,
  cause?: unknown,
): CarrierError {
  return new CarrierError({
    kind: "validation",
    code: "VALIDATION_ERROR",
    message,
    details,
    cause,
  });
}

export function fromZodError(err: ZodError): CarrierError {
  return validationError("Invalid input", err.flatten(), err);
}

export function configError(message: string, details?: unknown): CarrierError {
  return new CarrierError({
    kind: "config",
    code: "CONFIG_ERROR",
    message,
    details,
  });
}

export function authError(
  message: string,
  httpStatus?: number,
  details?: unknown,
): CarrierError {
  return new CarrierError({
    kind: "auth",
    code: "AUTH_ERROR",
    message,
    httpStatus,
    details,
  });
}

export function upstreamError(
  message: string,
  httpStatus: number,
  details?: unknown,
): CarrierError {
  return new CarrierError({
    kind: "upstream",
    code: "UPSTREAM_ERROR",
    message,
    httpStatus,
    details,
  });
}

/** Raised when the carrier kept answering 429 after the retry budget ran out. */
export function rateLimitError(
  message: string,
  httpStatus: number,
  details?: unknown,
): CarrierError {
  return new CarrierError({
    kind: "rate_limit",
    code: "RATE_LIMITED",
    message,
    httpStatus,
    details,
  });
}

export function timeoutError(message = "Request timed out"): CarrierError {
  return new CarrierError({
    kind: "timeout",
    code: "TIMEOUT",
    message,
  });
}

export function networkError(cause: unknown): CarrierError {
  return new CarrierError({
    kind: "upstream",
    code: "NETWORK_ERROR",
    message: cause instanceof Error ? cause.message : "Network request failed",
    cause,
  });
}

export function parseError(
  message: string,
  cause?: unknown,
  details?: unknown,
): CarrierError {
  return new CarrierError({
    kind: "parse",
    code: "PARSE_ERROR",
    message,
    details,
    cause,
  });
}
