import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import cors from "cors";
import {
  createCorsOriginCallback,
  DEFAULT_DEV_CORS_ORIGINS,
  resolveCorsAllowedOrigins,
} from "../src/config/cors.config.js";
import { createApp } from "../src/app.js";

describe("resolveCorsAllowedOrigins", () => {
  it("uses configured frontend and admin URLs", () => {
    expect(
      resolveCorsAllowedOrigins("https://app.example.com", "https://admin.example.com"),
    ).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("deduplicates identical origins", () => {
    expect(
      resolveCorsAllowedOrigins("https://app.example.com", "https://app.example.com"),
    ).toEqual(["https://app.example.com"]);
  });

  it("returns empty when both unset", () => {
    expect(resolveCorsAllowedOrigins(undefined, undefined)).toEqual([]);
  });
});

describe("createCorsOriginCallback", () => {
  function miniApp(options: { allowedOrigins: string[]; nodeEnv: string }) {
    const app = express();
    app.use(
      cors({
        origin: createCorsOriginCallback(options),
        credentials: true,
      }),
    );
    app.get("/ping", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  it("allows listed origins and sets reflect header", async () => {
    const app = miniApp({
      allowedOrigins: ["http://localhost:3000"],
      nodeEnv: "production",
    });
    const response = await request(app)
      .get("/ping")
      .set("Origin", "http://localhost:3000");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects untrusted origins when allowlist is explicit", async () => {
    const app = miniApp({
      allowedOrigins: ["http://localhost:3000"],
      nodeEnv: "production",
    });
    const response = await request(app)
      .get("/ping")
      .set("Origin", "https://evil.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("uses localhost defaults in development when env origins unset", async () => {
    const app = miniApp({ allowedOrigins: [], nodeEnv: "development" });
    const response = await request(app)
      .get("/ping")
      .set("Origin", DEFAULT_DEV_CORS_ORIGINS[0]);

    expect(response.headers["access-control-allow-origin"]).toBe(
      DEFAULT_DEV_CORS_ORIGINS[0],
    );
  });

  it("denies cross-origin in production when env origins unset", async () => {
    const app = miniApp({ allowedOrigins: [], nodeEnv: "production" });
    const response = await request(app)
      .get("/ping")
      .set("Origin", "http://localhost:3000");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows preflight for trusted origins", async () => {
    const app = miniApp({
      allowedOrigins: ["http://localhost:3000"],
      nodeEnv: "production",
    });
    const response = await request(app)
      .options("/ping")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects preflight for untrusted origins", async () => {
    const app = miniApp({
      allowedOrigins: ["http://localhost:3000"],
      nodeEnv: "production",
    });
    const response = await request(app)
      .options("/ping")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("createApp CORS integration", () => {
  it("reflects test FRONTEND_URL from vitest setup", async () => {
    const app = createApp({ exposeSwagger: false });
    const allowed = process.env.FRONTEND_URL ?? "http://localhost:3000";

    const trusted = await request(app).get("/health").set("Origin", allowed);
    expect(trusted.headers["access-control-allow-origin"]).toBe(allowed);

    const rejected = await request(app)
      .get("/health")
      .set("Origin", "https://unlisted.example");
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
