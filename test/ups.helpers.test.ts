import { describe, expect, it } from "vitest";
import {
  buildUpsShopRequest,
  mapRateResponseToQuotes,
  randomTransId,
  resolveAccountNumber,
} from "../src/ups/index.js";
import { cheapestQuote } from "../src/schemas/domain.js";
import { loadFixture, sampleRequest } from "./support/fixtures.js";

type ShopBody = {
  RateRequest: {
    Request: { RequestOption: string };
    Shipment: Record<string, unknown>;
  };
};

function shipmentOf(accountNumber: string | undefined, fallback: string) {
  const body = buildUpsShopRequest(
    { ...sampleRequest, shipper: { name: "Acme Inc", accountNumber } },
    fallback,
  ) as ShopBody;
  return body.RateRequest.Shipment;
}

describe("resolveAccountNumber", () => {
  it("prefers the account on the request", () => {
    expect(resolveAccountNumber("REQ1", "ENV1")).toBe("REQ1");
  });

  it("falls back to the configured account when the field is missing", () => {
    expect(resolveAccountNumber(undefined, "ENV1")).toBe("ENV1");
  });

  it("treats a blank account on the request as absent", () => {
    expect(resolveAccountNumber("   ", "ENV1")).toBe("ENV1");
    expect(resolveAccountNumber("", "ENV1")).toBe("ENV1");
  });

  it("resolves to an empty string when neither side supplies one", () => {
    expect(resolveAccountNumber("", "  ")).toBe("");
  });
});

describe("buildUpsShopRequest", () => {
  it("asks for every service with RequestOption Shop", () => {
    const body = buildUpsShopRequest(sampleRequest, "ACC123") as ShopBody;
    expect(body.RateRequest.Request.RequestOption).toBe("Shop");
  });

  it("bills the shipper account when one is resolvable", () => {
    const shipment = shipmentOf("REQ1", "ENV1");
    expect(shipment.Shipper).toMatchObject({ ShipperNumber: "REQ1" });
    expect(shipment.PaymentDetails).toMatchObject({
      ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: "REQ1" } }],
    });
  });

  it("uses the configured account when the request omits one", () => {
    expect(shipmentOf(undefined, "ENV1").Shipper).toMatchObject({
      ShipperNumber: "ENV1",
    });
  });

  it("omits the billing block entirely for a published-rate request", () => {
    const shipment = shipmentOf(undefined, "");
    expect(shipment.PaymentDetails).toBeUndefined();
    expect(shipment.Shipper).not.toHaveProperty("ShipperNumber");
  });

  it("sends a single package object and a list for multi-piece", () => {
    const single = buildUpsShopRequest(sampleRequest, "ACC") as ShopBody;
    expect(single.RateRequest.Shipment.NumOfPieces).toBe("1");
    expect(Array.isArray(single.RateRequest.Shipment.Package)).toBe(false);

    const multi = buildUpsShopRequest(
      {
        ...sampleRequest,
        packages: [...sampleRequest.packages, ...sampleRequest.packages],
      },
      "ACC",
    ) as ShopBody;
    expect(multi.RateRequest.Shipment.NumOfPieces).toBe("2");
    expect(Array.isArray(multi.RateRequest.Shipment.Package)).toBe(true);
  });

  it("narrows the request to one service when a service code is given", () => {
    const body = buildUpsShopRequest(
      { ...sampleRequest, serviceCode: "03" },
      "ACC",
    ) as ShopBody;
    expect(body.RateRequest.Shipment.Service).toEqual({ Code: "03" });
  });

  it("uppercases the country code through the domain schema", () => {
    const shipment = shipmentOf("REQ1", "ENV1");
    expect(shipment.ShipTo).toMatchObject({
      Address: expect.objectContaining({ CountryCode: "US" }),
    });
  });
});

describe("mapRateResponseToQuotes", () => {
  it("normalises the rated shipments in a Shop response", () => {
    const quotes = mapRateResponseToQuotes(loadFixture("ups-rating-success.json"));
    expect(quotes).toHaveLength(2);
    expect(cheapestQuote(quotes)?.totalPrice).toBe("12.34");
  });

  it("accepts a single rated shipment that is not wrapped in an array", () => {
    const quotes = mapRateResponseToQuotes({
      RateResponse: {
        RatedShipment: {
          Service: { Code: "03", Description: "Ground" },
          TotalCharges: { CurrencyCode: "USD", MonetaryValue: "9.99" },
        },
      },
    });
    expect(quotes).toEqual([
      {
        carrierId: "ups",
        serviceCode: "03",
        serviceName: "Ground",
        totalPrice: "9.99",
        currencyCode: "USD",
      },
    ]);
  });

  it("drops a service with no charges instead of quoting it at zero", () => {
    const quotes = mapRateResponseToQuotes({
      RateResponse: {
        RatedShipment: [
          { Service: { Code: "03" } },
          {
            Service: { Code: "02" },
            TotalCharges: { CurrencyCode: "USD", MonetaryValue: "45.67" },
          },
        ],
      },
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.serviceCode).toBe("02");
  });

  it("fails loudly when nothing in the response carries a price", () => {
    expect(() =>
      mapRateResponseToQuotes({
        RateResponse: { RatedShipment: [{ Service: { Code: "03" } }] },
      }),
    ).toThrowError(/no priced services/);
  });

  it("rejects a response shaped like something else entirely", () => {
    expect(() => mapRateResponseToQuotes({ oops: true })).toThrowError(
      /did not match expected shape/,
    );
  });
});

describe("randomTransId", () => {
  it("produces the 32-character id UPS expects", () => {
    expect(randomTransId()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomTransId()).not.toBe(randomTransId());
  });
});
