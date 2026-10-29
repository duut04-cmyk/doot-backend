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

  it("returns parse failure when status is false", () => {
    const parsed = parseShiprocketHyperlocalServiceability({
      status: false,
      message: "Not serviceable",
      data: [],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("returns parse failure for empty HTTP 200 body object", () => {
    const parsed = parseShiprocketHyperlocalServiceability({});
    expect(parsed.success).toBe(false);
    expect(parsed.candidates).toHaveLength(0);
  });
});
