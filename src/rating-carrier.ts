import { ZodError } from "zod";
import { fromZodError, validationError } from "./errors.js";
import {
  parseRateRequest,
  type RateQuote,
  type RateRequest,
} from "./schemas/domain.js";

/**
 * Port for carrier rating. Callers depend on this and nothing else, so a new
 * carrier is a new implementation rather than a change to existing code.
 */
export interface RatingCarrier {
  /** Stable identifier, echoed on every quote as `carrierId`. */
  readonly id: string;
  /** Takes unvalidated input; rejects with a `validation` CarrierError. */
  getRates(request: unknown): Promise<RateQuote[]>;
}

/**
 * Turns untrusted input into a `RateRequest`, or a `validation` CarrierError.
 * Kept in one place so every carrier rejects bad input identically.
 */
export function validateRateRequest(request: unknown): RateRequest {
  try {
    return parseRateRequest(request);
  } catch (e) {
    if (e instanceof ZodError) throw fromZodError(e);
    throw validationError("Invalid rate request", undefined, e);
  }
}

/**
 * Handles the validation half of the port so adapters only implement the part
 * that is actually carrier-specific: a typed request in, normalised quotes out.
 */
export abstract class BaseRatingCarrier implements RatingCarrier {
  abstract readonly id: string;

  async getRates(request: unknown): Promise<RateQuote[]> {
    return this.quote(validateRateRequest(request));
  }

  protected abstract quote(request: RateRequest): Promise<RateQuote[]>;
}
