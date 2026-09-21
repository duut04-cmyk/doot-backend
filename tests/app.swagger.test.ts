import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Swagger UI exposure", () => {
  it("serves Swagger UI when exposeSwagger is enabled", async () => {
    const app = createApp({ exposeSwagger: true });

    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger");
  });

  it("does not serve Swagger UI when exposeSwagger is disabled", async () => {
    const app = createApp({ exposeSwagger: false });

    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not expose a standalone OpenAPI JSON route in production mode", async () => {
    const app = createApp({ exposeSwagger: false });

    const response = await request(app).get("/api-docs/swagger.json");

    expect(response.status).toBe(404);
  });
});
