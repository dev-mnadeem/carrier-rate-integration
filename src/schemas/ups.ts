import { z } from "zod";
import { rateQuoteSchema } from "./domain.js";

/**
 * UPS returns `expires_in` as a JSON string ("3600"). A non-numeric value must
 * fail validation here: if it reached the token cache as NaN every comparison
 * against it would be false and the adapter would re-authenticate on every
 * single call.
 */
const expiresInSeconds = z.union([
  z
    .string()
    .trim()
    .regex(/^\d+$/, "expires_in must be a whole number of seconds")
    .transform((value) => Number(value)),
  z.number().int().nonnegative(),
]);

export const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: expiresInSeconds,
});

const moneySchema = z.object({
  CurrencyCode: z.string(),
  MonetaryValue: z.string(),
});

const ratedShipmentSchema = z.object({
  Service: z.object({
    Code: z.string(),
    Description: z.string().optional(),
  }),
  TotalCharges: moneySchema.optional(),
  BillingWeight: z
    .object({
      Weight: z.string().optional(),
    })
    .optional(),
});

export const rateResponseSchema = z.object({
  RateResponse: z.object({
    RatedShipment: z.union([ratedShipmentSchema, z.array(ratedShipmentSchema)]),
  }),
});

export const upsRateQuoteSchema = rateQuoteSchema.extend({
  carrierId: z.literal("ups"),
});

export type OauthTokenResponse = z.infer<typeof oauthTokenResponseSchema>;
export type RatedShipment = z.infer<typeof ratedShipmentSchema>;
export type RateResponse = z.infer<typeof rateResponseSchema>;
export type UpsRateQuote = z.infer<typeof upsRateQuoteSchema>;
