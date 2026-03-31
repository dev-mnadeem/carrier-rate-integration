import { BaseRatingCarrier } from "../rating-carrier.js";
import type {
  DimensionUnit,
  RateQuote,
  RateRequest,
  ShipmentPackage,
  WeightUnit,
} from "../schemas/domain.js";

export const FAKE_CARRIER_ID = "fake";

/**
 * Dimensional-weight divisor for inches and pounds. Carriers bill the greater
 * of actual and dimensional weight, which is why a large light box is not free.
 */
const DIM_DIVISOR_IN_LBS = 139;
const CM_PER_INCH = 2.54;
const LBS_PER_KG = 2.20462262;
const CURRENCY_CODE = "USD";
const BASE_CHARGE = 8.5;
const PER_LB_CHARGE = 0.62;
/** Each zone step away from the origin adds this share of the base charge. */
const PER_ZONE_SURCHARGE = 1.75;
const MAX_ZONE = 8;
const MIN_ZONE = 2;
/** Postal prefixes are compared as three-digit numbers, so 1000 buckets. */
const POSTAL_PREFIX_LENGTH = 3;
const POSTAL_BUCKETS = 1000;
const CENTS = 100;

type FakeService = {
  code: string;
  name: string;
  /** Multiplier applied to the zone-and-weight base price. */
  multiplier: number;
};

/** Service codes mirror the UPS ones so downstream mapping is exercised too. */
const SERVICES: readonly FakeService[] = [
  { code: "03", name: "Ground", multiplier: 1 },
  { code: "02", name: "2nd Day Air", multiplier: 2.1 },
  { code: "01", name: "Next Day Air", multiplier: 3.4 },
];

/**
 * A carrier that never leaves the process.
 *
 * Every price is a pure function of the request, so the test suite, the local
 * server and `docker compose up` all work with no carrier account and no
 * network. The numbers are a plausible-looking model, not UPS's tariff — do
 * not quote a customer from them.
 */
export class FakeRatingCarrier extends BaseRatingCarrier {
  readonly id = FAKE_CARRIER_ID;

  protected quote(request: RateRequest): Promise<RateQuote[]> {
    const billableWeightLbs = request.packages.reduce(
      (total, pkg) => total + billableWeightLbsFor(pkg),
      0,
    );
    const zone = zoneFor(request.origin.postalCode, request.destination.postalCode);
    const base =
      BASE_CHARGE +
      billableWeightLbs * PER_LB_CHARGE +
      (zone - MIN_ZONE) * PER_ZONE_SURCHARGE;

    const services = request.serviceCode
      ? SERVICES.filter((service) => service.code === request.serviceCode)
      : SERVICES;

    return Promise.resolve(
      services.map((service) => ({
        carrierId: this.id,
        serviceCode: service.code,
        serviceName: service.name,
        totalPrice: toMoney(base * service.multiplier),
        currencyCode: CURRENCY_CODE,
        billingWeight: toMoney(billableWeightLbs),
      })),
    );
  }
}

export function toLbs(value: number, unit: WeightUnit): number {
  return unit === "KGS" ? value * LBS_PER_KG : value;
}

export function toInches(value: number, unit: DimensionUnit): number {
  return unit === "CM" ? value / CM_PER_INCH : value;
}

/** The greater of actual weight and (L x W x H) / divisor, as carriers bill it. */
export function billableWeightLbsFor(pkg: ShipmentPackage): number {
  const { length, width, height, unit } = pkg.dimensions;
  const cubicInches =
    toInches(length, unit) * toInches(width, unit) * toInches(height, unit);
  const dimensionalLbs = cubicInches / DIM_DIVISOR_IN_LBS;
  return Math.max(toLbs(pkg.weight.value, pkg.weight.unit), dimensionalLbs);
}

/**
 * A stand-in for a zone chart: the further apart the postal prefixes, the
 * higher the zone, clamped to the usual 2-8 range. Deterministic and symmetric.
 */
export function zoneFor(originPostal: string, destinationPostal: string): number {
  const origin = postalPrefix(originPostal);
  const destination = postalPrefix(destinationPostal);
  const distance = Math.abs(origin - destination);
  const span = MAX_ZONE - MIN_ZONE;
  const steps = Math.round((distance / POSTAL_BUCKETS) * span * 2);
  return Math.min(MAX_ZONE, MIN_ZONE + Math.min(span, steps));
}

function postalPrefix(postalCode: string): number {
  const digits = postalCode.replace(/\D/g, "").slice(0, POSTAL_PREFIX_LENGTH);
  return digits.length ? Number(digits) : 0;
}

function toMoney(value: number): string {
  return (Math.round(value * CENTS) / CENTS).toFixed(2);
}
