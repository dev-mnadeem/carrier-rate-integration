import { randomBytes } from "node:crypto";
import { parseError } from "../errors.js";
import type {
  Address,
  RateQuote,
  RateRequest,
  ShipmentPackage,
} from "../schemas/domain.js";
import { rateResponseSchema, upsRateQuoteSchema } from "../schemas/ups.js";

export const UPS_CARRIER_ID = "ups";
/** UPS wants a transId of 32 characters; 16 random bytes in hex is exactly that. */
const TRANS_ID_BYTES = 16;
/** Echoed back by UPS on every response, useful when correlating support tickets. */
export const TRANSACTION_SOURCE = "cybership-carrier-integration";
/** UPS payment-charge type 01 = transportation charges. */
const SHIPMENT_CHARGE_TRANSPORTATION = "01";

export function randomTransId(): string {
  return randomBytes(TRANS_ID_BYTES).toString("hex");
}

export function mapAddress(addr: Address): Record<string, unknown> {
  return {
    AddressLine: addr.lines,
    City: addr.city,
    ...(addr.stateProvinceCode
      ? { StateProvinceCode: addr.stateProvinceCode }
      : {}),
    PostalCode: addr.postalCode,
    CountryCode: addr.countryCode,
  };
}

export function mapPackage(pkg: ShipmentPackage): Record<string, unknown> {
  return {
    PackagingType: { Code: pkg.packagingTypeCode },
    Dimensions: {
      UnitOfMeasurement: { Code: pkg.dimensions.unit },
      Length: String(pkg.dimensions.length),
      Width: String(pkg.dimensions.width),
      Height: String(pkg.dimensions.height),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: pkg.weight.unit },
      Weight: String(pkg.weight.value),
    },
  };
}

/**
 * Per-request shipper account wins, then the configured default. An account
 * number of `""` counts as absent — `??` alone would have let a blank field in
 * an inbound payload suppress the configured account.
 */
export function resolveAccountNumber(
  requestAccountNumber: string | undefined,
  defaultAccountNumber: string,
): string {
  return (requestAccountNumber ?? "").trim() || defaultAccountNumber.trim();
}

export function buildUpsShopRequest(
  req: RateRequest,
  defaultAccountNumber: string,
): unknown {
  const accountNumber = resolveAccountNumber(
    req.shipper.accountNumber,
    defaultAccountNumber,
  );

  const shipment: Record<string, unknown> = {
    Shipper: {
      Name: req.shipper.name,
      ...(accountNumber ? { ShipperNumber: accountNumber } : {}),
      Address: mapAddress(req.origin),
    },
    ShipTo: {
      Name: req.destination.name ?? "Recipient",
      Address: mapAddress(req.destination),
    },
    ShipFrom: {
      Name: req.origin.name ?? req.shipper.name,
      Address: mapAddress(req.origin),
    },
    // Published rates can be requested without an account; only send the
    // BillShipper block when we actually have a number to bill.
    ...(accountNumber
      ? {
          PaymentDetails: {
            ShipmentCharge: [
              {
                Type: SHIPMENT_CHARGE_TRANSPORTATION,
                BillShipper: { AccountNumber: accountNumber },
              },
            ],
          },
        }
      : {}),
    NumOfPieces: String(req.packages.length),
    Package:
      req.packages.length === 1
        ? mapPackage(req.packages[0])
        : req.packages.map(mapPackage),
  };

  if (req.serviceCode) {
    shipment.Service = { Code: req.serviceCode };
  }

  return {
    RateRequest: {
      Request: {
        RequestOption: "Shop",
        TransactionReference: { CustomerContext: TRANSACTION_SOURCE },
      },
      Shipment: shipment,
    },
  };
}

/**
 * Normalises a UPS Shop response into domain quotes.
 *
 * A rated shipment with no `TotalCharges` is dropped rather than reported at a
 * price of zero: a quote of 0.00 would flow straight into a checkout total.
 * If that leaves nothing at all, the response is treated as unusable.
 */
export function mapRateResponseToQuotes(json: unknown): RateQuote[] {
  const parsed = rateResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw parseError(
      "UPS Rating response did not match expected shape",
      parsed.error,
      json,
    );
  }

  const node = parsed.data.RateResponse.RatedShipment;
  const ratedShipments = Array.isArray(node) ? node : [node];

  const quotes = ratedShipments
    .filter((shipment) => shipment.TotalCharges !== undefined)
    .map((shipment) =>
      upsRateQuoteSchema.parse({
        carrierId: UPS_CARRIER_ID,
        serviceCode: shipment.Service.Code,
        serviceName: shipment.Service.Description,
        totalPrice: shipment.TotalCharges!.MonetaryValue,
        currencyCode: shipment.TotalCharges!.CurrencyCode,
        billingWeight: shipment.BillingWeight?.Weight,
      }),
    );

  if (quotes.length === 0) {
    throw parseError("UPS Rating returned no priced services", undefined, json);
  }

  return quotes;
}
