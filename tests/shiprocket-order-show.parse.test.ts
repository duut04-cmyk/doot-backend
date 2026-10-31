import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractShiprocketOrderShowAwb,
  isValidShiprocketAwbCode,
  parseShiprocketOrderShowDetails,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-order-show.parse.js";
import { parseShiprocketOrderShowBody } from "../src/modules/provider/adapters/shiprocket/shiprocket-order.util.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

describe("Shiprocket order-show parsing", () => {
  it("extracts AWB from shipments.awb when top-level awb_code is null", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "order-show-shipment-awb.json"), "utf8"),
    );
    const details = parseShiprocketOrderShowDetails(body);
    expect(details?.awbCode).toBe("SR999888777IN");
    expect(details?.courierName).toBe("QuickCourier");
    expect(isValidShiprocketAwbCode(details?.awbCode)).toBe(true);
  });

  it("extracts AWB from awb_data object", () => {
    const awb = extractShiprocketOrderShowAwb({
      awb_data: { awb: "SR111222333IN" },
      shipments: [{ id: 1 }],
    });
    expect(awb).toBe("SR111222333IN");
  });

  it("extracts AWB from awb_data array", () => {
    const awb = extractShiprocketOrderShowAwb({
      awb_data: [{ awb_code: "SR444555666IN" }],
      shipments: [{ id: 1 }],
    });
    expect(awb).toBe("SR444555666IN");
  });

  it("builds created-order snapshot with shipment AWB", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "order-show-shipment-awb.json"), "utf8"),
    );
    const snapshot = parseShiprocketOrderShowBody(body);
    expect(snapshot?.awbCode).toBe("SR999888777IN");
    expect(snapshot?.shipmentId).toBe("15151515");
  });

  it("rejects invalid AWB patterns", () => {
    expect(isValidShiprocketAwbCode("")).toBe(false);
    expect(isValidShiprocketAwbCode("NA")).toBe(false);
    expect(isValidShiprocketAwbCode("SR123456789IN")).toBe(true);
  });

  it("parses order-show when shipments is a single object", () => {
    const body = JSON.parse(
      readFileSync(join(fixtureDir, "order-show-shipment-object.json"), "utf8"),
    );
    const details = parseShiprocketOrderShowDetails(body);
    expect(details?.shipmentId).toBe("18181818");
    expect(details?.awbCode).toBe("SR777888999IN");
    const snapshot = parseShiprocketOrderShowBody(body);
    expect(snapshot?.awbCode).toBe("SR777888999IN");
  });
});
