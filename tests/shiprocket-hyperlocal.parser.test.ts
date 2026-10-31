import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseShiprocketHyperlocalServiceability } from "../src/modules/provider/adapters/shiprocket/shiprocket-hyperlocal.parser.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/shiprocket");

describe("parseShiprocketHyperlocalServiceability", () => {
  it("parses Sandbox panel example with string rate 345.3", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(fixtureDir, "hyperlocal-serviceability-panel-example.json"),
        "utf8",
      ),
    );
    const parsed = parseShiprocketHyperlocalServiceability(fixture);
    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.courierName).toBe("Shiprocket Quick");
    expect(parsed.candidates[0]?.amountInr).toBe(345.3);
  });

  it("returns success with no candidates when status is true and data is empty", () => {
    const parsed = parseShiprocketHyperlocalServiceability({
      status: true,
      data: [],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("returns valid zero candidates when status is false (no serviceability)", () => {
    const parsed = parseShiprocketHyperlocalServiceability({
      status: false,
      message: "No serviceability found",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.malformed).toBe(false);
    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.providerMessage).toBe("No serviceability found");
  });

  it("returns malformed for empty HTTP 200 body object", () => {
    const parsed = parseShiprocketHyperlocalServiceability({});
    expect(parsed.success).toBe(false);
    expect(parsed.malformed).toBe(true);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("parses three distinct courier candidates", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(fixtureDir, "hyperlocal-serviceability-three-couriers.json"),
        "utf8",
      ),
    );
    const parsed = parseShiprocketHyperlocalServiceability(fixture);
    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(3);
    expect(parsed.candidates.map((c) => c.courierName)).toEqual([
      "Courier Alpha",
      "Courier Beta",
      "Courier Gamma",
    ]);
    expect(parsed.candidates.map((c) => c.providerQuoteId)).toEqual([
      "hl-rate-201",
      "hl-rate-202",
      "hl-rate-203",
    ]);
  });
});
