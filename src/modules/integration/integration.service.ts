import { env, getEmailFromAddress, isMsg91Configured } from "../../config/env.js";
import { getPrismaClient } from "../../config/database.js";
import type {
  IntegrationCategoryDto,
  IntegrationItemDto,
  IntegrationsStatusDto,
  IntegrationStatus,
} from "./integration.types.js";

const BORZO_WEBHOOK_PATH = "/api/v1/providers/borzo/webhooks";

function statusLabel(status: IntegrationStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "not_configured":
      return "Not configured";
    case "degraded":
      return "Degraded";
    case "coming_soon":
      return "Coming soon";
    default:
      return status;
  }
}

function item(partial: Omit<IntegrationItemDto, "statusLabel">): IntegrationItemDto {
  return {
    ...partial,
    statusLabel: statusLabel(partial.status),
  };
}

async function isDatabaseReachable(): Promise<boolean> {
  if (!env.DATABASE_URL) {
    return false;
  }

  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function isEncryptionConfigured(): boolean {
  return Boolean(env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY?.trim());
}

export class IntegrationService {
  async getStatus(): Promise<{ success: true; data: IntegrationsStatusDto }> {
    const fromEmail = getEmailFromAddress();
    const resendConfigured = Boolean(env.RESEND_API_KEY && fromEmail);
    const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID);
    const databaseConfigured = Boolean(env.DATABASE_URL);
    const databaseReachable = databaseConfigured ? await isDatabaseReachable() : false;
    const encryptionConfigured = isEncryptionConfigured();
    const borzoSecretConfigured = Boolean(env.BORZO_CALLBACK_SECRET);
    const borzoWebhooksEnabled = env.BORZO_WEBHOOKS_ENABLED;

    const categories: IntegrationCategoryDto[] = [
      {
        id: "identity",
        title: "Identity & access",
        description: "Authentication services used by customer-facing apps.",
        items: [
          item({
            id: "google-sign-in",
            name: "Google Sign-In",
            description: "Customer OAuth login via Google ID tokens.",
            category: "identity",
            status: googleConfigured ? "connected" : "not_configured",
            usedBy: "Customer app login",
            impact: "Without Google, customers can only use email and password.",
            metadata: googleConfigured
              ? { clientIdHint: `${env.GOOGLE_CLIENT_ID!.slice(0, 12)}…` }
              : {},
            manageHref: null,
          }),
        ],
      },
      {
        id: "communications",
        title: "Communications",
        description: "Outbound messaging for auth and delivery operations.",
        items: [
          item({
            id: "resend-email",
            name: "Resend Email",
            description: "Transactional email for OTP and notifications.",
            category: "communications",
            status: resendConfigured ? "connected" : "not_configured",
            usedBy: "Email verification, password reset, pickup/delivery OTP",
            impact: "OTP and password reset emails will fail without Resend.",
            metadata: fromEmail ? { fromEmail } : {},
            manageHref: null,
          }),
          item({
            id: "sms-provider",
            name: "MSG91 SMS",
            description: "Pickup and delivery OTP notifications via SMS.",
            category: "communications",
            status:
              env.MSG91_ENABLED && isMsg91Configured()
                ? "connected"
                : env.MSG91_ENABLED
                  ? "not_configured"
                  : "not_configured",
            usedBy: "Pickup OTP and delivery OTP SMS notifications",
            impact:
              "Pickup/delivery OTP SMS will not be sent when MSG91 is disabled or misconfigured. Email remains active.",
            metadata: env.MSG91_ENABLED ? { senderId: env.MSG91_SENDER_ID ?? "" } : {},
            manageHref: null,
          }),
        ],
      },
      {
        id: "infrastructure",
        title: "Infrastructure",
        description: "Core platform dependencies.",
        items: [
          item({
            id: "postgresql",
            name: "PostgreSQL (Supabase)",
            description: "Primary database for users, deliveries, and orchestration.",
            category: "infrastructure",
            status: !databaseConfigured
              ? "not_configured"
              : databaseReachable
                ? "connected"
                : "degraded",
            usedBy: "All platform data",
            impact: "The API cannot persist data without a reachable database.",
            metadata: databaseConfigured ? { configured: "true" } : {},
            manageHref: null,
          }),
          item({
            id: "object-storage",
            name: "Object storage",
            description: "Package photo uploads and media storage.",
            category: "infrastructure",
            status: "coming_soon",
            usedBy: "Delivery package photos",
            impact: "Photo uploads are not available yet.",
            metadata: {},
            manageHref: null,
          }),
          item({
            id: "maps-geocoding",
            name: "Maps & geocoding",
            description: "Address validation and coordinate lookup.",
            category: "infrastructure",
            status: "coming_soon",
            usedBy: "Delivery address enrichment",
            impact: "Coordinates must be supplied manually today.",
            metadata: {},
            manageHref: null,
          }),
        ],
      },
      {
        id: "webhooks",
        title: "Inbound webhooks",
        description: "Provider callbacks into the Doot platform.",
        items: [
          item({
            id: "borzo-webhooks",
            name: "Borzo webhooks",
            description: "Order and delivery status events from Borzo.",
            category: "webhooks",
            status: !borzoSecretConfigured
              ? "not_configured"
              : borzoWebhooksEnabled
                ? "connected"
                : "degraded",
            usedBy: "Live delivery status updates from Borzo",
            impact: "Without webhooks, status updates rely on polling only.",
            metadata: {
              webhookPath: BORZO_WEBHOOK_PATH,
              secretConfigured: String(borzoSecretConfigured),
              enabled: String(borzoWebhooksEnabled),
            },
            manageHref: "/providers",
          }),
        ],
      },
      {
        id: "security",
        title: "Security & secrets",
        description: "Encryption and signing configuration.",
        items: [
          item({
            id: "credential-encryption",
            name: "Provider credential encryption",
            description: "AES-256-GCM encryption for stored provider secrets.",
            category: "security",
            status: encryptionConfigured ? "connected" : "not_configured",
            usedBy: "Provider API credentials at rest",
            impact: "Provider credentials cannot be stored securely without this key.",
            metadata: {},
            manageHref: null,
          }),
          item({
            id: "borzo-webhook-signing",
            name: "Borzo webhook signing",
            description: "HMAC verification for inbound Borzo webhook payloads.",
            category: "security",
            status: borzoSecretConfigured ? "connected" : "not_configured",
            usedBy: "Borzo webhook endpoint",
            impact: "Webhook signature verification cannot be enforced.",
            metadata: {},
            manageHref: null,
          }),
        ],
      },
    ];

    const activeItems = categories.flatMap((category) =>
      category.items.filter((entry) => entry.status !== "coming_soon"),
    );

    const connected = activeItems.filter(
      (entry) => entry.status === "connected",
    ).length;
    const needsAttention = activeItems.filter(
      (entry) => entry.status === "not_configured" || entry.status === "degraded",
    ).length;

    return {
      success: true,
      data: {
        summary: {
          connected,
          total: activeItems.length,
          needsAttention,
        },
        categories,
        checkedAt: new Date().toISOString(),
      },
    };
  }
}

export const integrationService = new IntegrationService();
