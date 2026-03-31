import { z } from "zod";

export const countryCodeSchema = z
  .string()
  .length(2)
  .transform((c) => c.toUpperCase());

export const addressSchema = z.object({
  name: z.string().min(1).optional(),
  lines: z.array(z.string().min(1)).min(1).max(3),
  city: z.string().min(1),
  stateProvinceCode: z.string().min(1).optional(),
  postalCode: z.string().min(1),
  countryCode: countryCodeSchema,
});

export const weightUnitSchema = z.enum(["LBS", "KGS"]);
export const dimensionUnitSchema = z.enum(["IN", "CM"]);

export const packageSchema = z.object({
  packagingTypeCode: z.string().min(1).default("02"),
  weight: z.object({
    value: z.number().positive(),
    unit: weightUnitSchema,
  }),
  dimensions: z.object({
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: dimensionUnitSchema,
  }),
});

export const shipperSchema = z.object({
  name: z.string().min(1),
  accountNumber: z.string().optional(),
});

export const rateRequestSchema = z.object({
  origin: addressSchema,
  destination: addressSchema,
  shipper: shipperSchema,
  packages: z.array(packageSchema).min(1),
  serviceCode: z.string().min(1).optional(),
});

export const rateQuoteSchema = z.object({
  carrierId: z.string(),
  serviceCode: z.string(),
  serviceName: z.string().optional(),
  totalPrice: z.string(),
  currencyCode: z.string(),
  billingWeight: z.string().optional(),
});

export function parseRateRequest(input: unknown): RateRequest {
  return rateRequestSchema.parse(input);
}

/**
 * Cheapest quote by numeric total. Quotes whose `totalPrice` is not a number
 * are ignored rather than sorting to the front as NaN.
 */
export function cheapestQuote(quotes: RateQuote[]): RateQuote | undefined {
  let best: RateQuote | undefined;
  let bestValue = Number.POSITIVE_INFINITY;
  for (const quote of quotes) {
    const value = Number(quote.totalPrice);
    if (!Number.isFinite(value)) continue;
    if (value < bestValue) {
      best = quote;
      bestValue = value;
    }
  }
  return best;
}

export type Address = z.infer<typeof addressSchema>;
export type WeightUnit = z.infer<typeof weightUnitSchema>;
export type DimensionUnit = z.infer<typeof dimensionUnitSchema>;
export type ShipmentPackage = z.infer<typeof packageSchema>;
export type Shipper = z.infer<typeof shipperSchema>;
export type RateRequest = z.infer<typeof rateRequestSchema>;
export type RateQuote = z.infer<typeof rateQuoteSchema>;
