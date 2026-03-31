import { describe, expect, it } from "vitest";
import {
  FakeRatingCarrier,
  billableWeightLbsFor,
  zoneFor,
} from "../src/fake/index.js";
import { cheapestQuote } from "../src/schemas/domain.js";
import { sampleRequest } from "./support/fixtures.js";

describe("FakeRatingCarrier", () => {
  it("quotes every service and is deterministic across calls", async () => {
    const carrier = new FakeRatingCarrier();
    const first = await carrier.getRates(sampleRequest);
    const second = await carrier.getRates(sampleRequest);

    expect(first).toHaveLength(3);
    expect(first.map((q) => q.serviceCode)).toEqual(["03", "02", "01"]);
    expect(second).toEqual(first);
    for (const quote of first) {
      expect(quote.carrierId).toBe("fake");
      expect(quote.currencyCode).toBe("USD");
      expect(quote.totalPrice).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("returns only the requested service when one is named", async () => {
    const carrier = new FakeRatingCarrier();
    const quotes = await carrier.getRates({
      ...sampleRequest,
      serviceCode: "01",
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.serviceCode).toBe("01");
  });

  it("prices faster services above ground", async () => {
    const carrier = new FakeRatingCarrier();
    const quotes = await carrier.getRates(sampleRequest);
    const ground = Number(quotes.find((q) => q.serviceCode === "03")?.totalPrice);
    const nextDay = Number(quotes.find((q) => q.serviceCode === "01")?.totalPrice);
    expect(nextDay).toBeGreaterThan(ground);
    expect(cheapestQuote(quotes)?.serviceCode).toBe("03");
  });

  it("charges more for a longer haul", async () => {
    const carrier = new FakeRatingCarrier();
    const near = await carrier.getRates({
      ...sampleRequest,
      destination: { ...sampleRequest.destination, postalCode: "21094" },
    });
    const far = await carrier.getRates({
      ...sampleRequest,
      destination: { ...sampleRequest.destination, postalCode: "99501" },
    });
    expect(Number(far[0]?.totalPrice)).toBeGreaterThan(Number(near[0]?.totalPrice));
  });

  it("rejects an invalid request through the shared validation path", async () => {
    const carrier = new FakeRatingCarrier();
    await expect(carrier.getRates({ origin: {} })).rejects.toMatchObject({
      kind: "validation",
      code: "VALIDATION_ERROR",
    });
  });

  it("bills the greater of actual and dimensional weight", () => {
    const heavySmallBox = billableWeightLbsFor({
      packagingTypeCode: "02",
      weight: { value: 40, unit: "LBS" },
      dimensions: { length: 5, width: 5, height: 5, unit: "IN" },
    });
    expect(heavySmallBox).toBe(40);

    const lightBigBox = billableWeightLbsFor({
      packagingTypeCode: "02",
      weight: { value: 1, unit: "LBS" },
      dimensions: { length: 24, width: 24, height: 24, unit: "IN" },
    });
    expect(lightBigBox).toBeCloseTo(13824 / 139, 6);
  });

  it("treats metric inputs as their imperial equivalents", () => {
    const metric = billableWeightLbsFor({
      packagingTypeCode: "02",
      weight: { value: 10, unit: "KGS" },
      dimensions: { length: 10, width: 10, height: 10, unit: "CM" },
    });
    expect(metric).toBeCloseTo(22.0462262, 5);
  });

  it("derives a symmetric zone inside the 2-8 range", () => {
    expect(zoneFor("21093", "21094")).toBe(2);
    expect(zoneFor("21093", "99501")).toBe(8);
    expect(zoneFor("99501", "21093")).toBe(zoneFor("21093", "99501"));
  });
});
