import {
  env,
  getEmailFromAddress,
  isOperationalSmsEnabled,
  isTwilioConfigured,
  canResolvePackagePhotoUrls,
  isObjectStorageConfigured,
} from "../../config/env.js";
import { getPrismaClient } from "../../config/database.js";
import type {
  IntegrationCategoryDto,
  IntegrationItemDto,
  IntegrationsStatusDto,
  IntegrationStatus,
} from "./integration.types.js";

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

    const categories: IntegrationCategoryDto[] = [
      {
        id: "identity",
        title: "Identity & access",
        description: "Auth",
        items: [
          item({
            id: "google-sign-in",
            name: "Google Sign-In",
            description: "Customer OAuth via Google.",
            category: "identity",
            status: googleConfigured ? "connected" : "not_configured",
            usedBy: "Customer login",
            impact: "Email/password login only.",
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
        description: "Email & SMS",
        items: [
          item({
            id: "resend-email",
            name: "Resend Email",
            description: "Transactional email for OTP and alerts.",
            category: "communications",
            status: resendConfigured ? "connected" : "not_configured",
            usedBy: "Verification & password reset",
            impact: "Auth emails stop.",
            metadata: fromEmail ? { fromEmail } : {},
            manageHref: null,
          }),
          item({
            id: "sms-provider",
            name:
              env.SMS_PROVIDER === "twilio"
                ? "Twilio SMS"
                : env.SMS_PROVIDER === "msg91"
                  ? "MSG91 SMS"
                  : "Operational SMS (mock)",
            description: "Pickup and delivery OTP SMS.",
            category: "communications",
            status: isOperationalSmsEnabled() ? "connected" : "not_configured",
            usedBy: "Pickup & delivery OTP",
            impact: "OTP SMS unavailable.",
            metadata:
              env.SMS_PROVIDER === "twilio"
                ? {
                    provider: "twilio",
                    fromConfigured: String(isTwilioConfigured()),
                  }
                : env.SMS_PROVIDER === "msg91"
                  ? { provider: "msg91", senderId: env.MSG91_SENDER_ID ?? "" }
                  : { provider: env.SMS_PROVIDER },
            manageHref: null,
          }),
        ],
      },
      {
        id: "infrastructure",
        title: "Infrastructure",
        description: "Data & storage",
        items: [
          item({
            id: "postgresql",
            name: "PostgreSQL (Supabase)",
            description: "Primary database.",
            category: "infrastructure",
            status: !databaseConfigured
              ? "not_configured"
              : databaseReachable
                ? "connected"
                : "degraded",
            usedBy: "All platform data",
            impact: "API cannot persist data.",
            metadata: databaseConfigured ? { configured: "true" } : {},
            manageHref: null,
          }),
          item({
            id: "object-storage",
            name: "Cloudflare R2",
            description: "Package photo storage.",
            category: "infrastructure",
            status: canResolvePackagePhotoUrls() ? "connected" : "not_configured",
            usedBy: "Package photos",
            impact: "Package photo URLs unavailable.",
            metadata: env.R2_PUBLIC_BASE_URL
              ? { publicBase: "configured" }
              : isObjectStorageConfigured()
                ? { bucket: env.R2_BUCKET_NAME ?? "doot" }
                : {},
            manageHref: null,
          }),
          item({
            id: "maps-geocoding",
            name: "Maps & geocoding",
            description: "Address validation and lookup.",
            category: "infrastructure",
            status: "coming_soon",
            usedBy: "Address enrichment",
            impact: "Coordinates must be entered manually.",
            metadata: {},
            manageHref: null,
          }),
        ],
      },
      {
        id: "security",
        title: "Security & secrets",
        description: "Secrets",
        items: [
          item({
            id: "credential-encryption",
            name: "Provider credential encryption",
            description: "AES-256-GCM for provider secrets.",
            category: "security",
            status: encryptionConfigured ? "connected" : "not_configured",
            usedBy: "Provider credentials",
            impact: "Provider secrets cannot be stored.",
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
