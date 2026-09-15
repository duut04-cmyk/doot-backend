import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { createAuthenticateMiddleware } from "../src/core/middleware/authenticate.js";
import { errorHandlerMiddleware } from "../src/core/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/core/middleware/request-id.js";
import { generateAccessToken } from "../src/modules/auth/auth.crypto.js";
import { BorzoAdapter } from "../src/modules/provider/adapters/borzo/borzo.adapter.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { ProviderController } from "../src/modules/provider/provider.controller.js";
import { ProviderIntegrationService } from "../src/modules/provider/provider.integration.service.js";
import { createProviderAdminRouter } from "../src/modules/provider/provider.routes.js";
import { ProviderService } from "../src/modules/provider/provider.service.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import {
  sampleQuoteRequest,
  successfulBorzoCalculateOrderResponse,
} from "./helpers/borzo-test-fixtures.js";
import { seedBorzoProvider } from "./helpers/provider-adapter-test-helpers.js";

describe("Borzo admin integration endpoints", () => {
  let providerRepo: InMemoryProviderRepository;
  let authRepo: InMemoryAuthRepository;
  let adminId: string;
  let customerId: string;
  let borzoProviderId: string;
  let registry: ProviderAdapterRegistry;

  beforeEach(async () => {
    providerRepo = new InMemoryProviderRepository();
    authRepo = new InMemoryAuthRepository();
    registry = new ProviderAdapterRegistry();

    const calculateOrder = vi
      .fn()
      .mockResolvedValue(successfulBorzoCalculateOrderResponse);
    const ping = vi.fn().mockResolvedValue({ healthy: true, durationMs: 120 });
    registry.register(
      new BorzoAdapter({ calculateOrder, ping } as never),
    );

    const admin = await authRepo.createUser({
      name: "Admin User",
      email: "admin@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    admin.role = "ADMIN";
    adminId = admin.id;

    const customer = await authRepo.createUser({
      name: "Customer User",
      email: "customer@example.com",
      passwordHash: "hash",
      emailVerified: true,
    });
    customer.role = "CUSTOMER";
    customerId = customer.id;

    borzoProviderId = await seedBorzoProvider(providerRepo, {
      integrationStatus: "CONFIGURED",
    });
  });

  function buildApp() {
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(providerRepo),
    );
    const integrationService = new ProviderIntegrationService(resolver);
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    const authenticate = createAuthenticateMiddleware(authRepo);
    app.use(
      "/api/v1/admin/providers",
      createProviderAdminRouter(
        new ProviderController(new ProviderService(providerRepo), integrationService),
        authenticate,
      ),
    );
    app.use(errorHandlerMiddleware);
    return app;
  }

  function tokenFor(userId: string) {
    return generateAccessToken(userId);
  }

  it("returns 401 when unauthenticated", async () => {
    const app = buildApp();
    const response = await request(app).post(
      `/api/v1/admin/providers/${borzoProviderId}/test-connection`,
    );
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("returns 403 for CUSTOMER role", async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`/api/v1/admin/providers/${borzoProviderId}/test-connection`)
      .set("Authorization", `Bearer ${tokenFor(customerId)}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it("returns sanitized test-connection result for ADMIN", async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`/api/v1/admin/providers/${borzoProviderId}/test-connection`)
      .set("Authorization", `Bearer ${tokenFor(adminId)}`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.providerCode).toBe("BORZO");
    expect(response.body.data.environment).toBe("SANDBOX");
    expect(response.body.data.connected).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("borzo-test-token");
  });

  it("returns normalized test-quote result without raw Borzo JSON", async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`/api/v1/admin/providers/${borzoProviderId}/test-quote`)
      .set("Authorization", `Bearer ${tokenFor(adminId)}`)
      .send(sampleQuoteRequest);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.providerCode).toBe("BORZO");
    expect(response.body.data.quote.amount.amount).toBe(170);
    expect(response.body.data.serviceability.serviceable).toBe(true);
    expect(response.body.data.availability.known).toBe(false);
    expect(response.body.data.availability.available).toBe(false);
    expect(response.body.data.providerMetadata.borzoVehicleTypeId).toBe(8);
    expect(JSON.stringify(response.body)).not.toContain("is_successful");
    expect(JSON.stringify(response.body)).not.toContain("borzo-test-token");
  });

  it("returns 422 when provider is disabled", async () => {
    await providerRepo.updateProvider(borzoProviderId, { enabled: false });
    const app = buildApp();
    const response = await request(app)
      .post(`/api/v1/admin/providers/${borzoProviderId}/test-quote`)
      .set("Authorization", `Bearer ${tokenFor(adminId)}`)
      .send(sampleQuoteRequest);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe(ErrorCodes.PROVIDER_DISABLED);
  });

  it("returns 400 for invalid test-quote body", async () => {
    const app = buildApp();
    const response = await request(app)
      .post(`/api/v1/admin/providers/${borzoProviderId}/test-quote`)
      .set("Authorization", `Bearer ${tokenFor(adminId)}`)
      .send({ pickup: { addressText: "A" } });
    expect(response.status).toBe(400);
  });
});
