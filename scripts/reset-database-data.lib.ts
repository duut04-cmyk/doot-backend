import type { Prisma, PrismaClient } from "@prisma/client";
import { provisionAdminUser, type AdminSeedResult } from "../prisma/seed-admin.js";

export class CleanupRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanupRefusedError";
  }
}

export type SafeDatabaseIdentification = {
  provider: "postgresql";
  host: string;
  port: string;
  database: string;
};

export type ModelCountEntry = {
  model: string;
  count: number;
};

type TransactionClient = Prisma.TransactionClient;

type CountableClient = Pick<PrismaClient, "$queryRaw"> & {
  [K in keyof PrismaClient as K extends `$${string}` ? never : K]: PrismaClient[K];
};

const APPLICATION_MODELS = [
  "CancellationIdempotencyKey",
  "DeliveryCancellation",
  "DeliveryTrackingPoint",
  "DeliveryOtp",
  "DriverAssignment",
  "BookingConfirmIdempotencyKey",
  "ProviderBooking",
  "OrchestrationOption",
  "OrchestrationEvaluation",
  "OrchestrationRequest",
  "DeliveryIdempotencyKey",
  "DeliveryStatusEvent",
  "DeliveryHandlingRequirement",
  "DeliveryPackagePhoto",
  "DeliveryPackage",
  "DeliveryCompliance",
  "DeliverySchedule",
  "DeliveryPickup",
  "DeliveryDrop",
  "DeliveryRating",
  "DeliveryFeedback",
  "Delivery",
  "ProviderWebhookEvent",
  "ProviderCredential",
  "ProviderCapabilityRecord",
  "ProviderService",
  "ProviderVehicle",
  "ProviderSettings",
  "ProviderPackageLimits",
  "Provider",
  "AdminAuditLog",
  "OAuthAccount",
  "EmailVerificationOtp",
  "PasswordResetOtp",
  "PasswordResetVerificationToken",
  "RefreshToken",
  "User",
] as const;

export type ApplicationModelName = (typeof APPLICATION_MODELS)[number];

export const DELETION_ORDER: ApplicationModelName[] = [...APPLICATION_MODELS];

export function assertCleanupAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.ALLOW_DATABASE_DATA_RESET !== "true") {
    throw new CleanupRefusedError(
      "Refused: set ALLOW_DATABASE_DATA_RESET=true to delete application data.",
    );
  }

  if (env.NODE_ENV === "production") {
    throw new CleanupRefusedError(
      "Refused: database data cleanup is not allowed when NODE_ENV=production.",
    );
  }
}

export function parseSafeDatabaseIdentification(
  databaseUrl: string,
): SafeDatabaseIdentification {
  try {
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "unknown";
    return {
      provider: "postgresql",
      host: url.hostname || "unknown",
      port: url.port || "5432",
      database,
    };
  } catch {
    return {
      provider: "postgresql",
      host: "unknown",
      port: "5432",
      database: "unknown",
    };
  }
}

async function countModel(
  client: CountableClient | TransactionClient,
  model: ApplicationModelName,
): Promise<number> {
  switch (model) {
    case "CancellationIdempotencyKey":
      return client.cancellationIdempotencyKey.count();
    case "DeliveryCancellation":
      return client.deliveryCancellation.count();
    case "DeliveryTrackingPoint":
      return client.deliveryTrackingPoint.count();
    case "DeliveryOtp":
      return client.deliveryOtp.count();
    case "DriverAssignment":
      return client.driverAssignment.count();
    case "BookingConfirmIdempotencyKey":
      return client.bookingConfirmIdempotencyKey.count();
    case "ProviderBooking":
      return client.providerBooking.count();
    case "OrchestrationOption":
      return client.orchestrationOption.count();
    case "OrchestrationEvaluation":
      return client.orchestrationEvaluation.count();
    case "OrchestrationRequest":
      return client.orchestrationRequest.count();
    case "DeliveryIdempotencyKey":
      return client.deliveryIdempotencyKey.count();
    case "DeliveryStatusEvent":
      return client.deliveryStatusEvent.count();
    case "DeliveryPackagePhoto":
      return client.deliveryPackagePhoto.count();
    case "DeliveryPackage":
      return client.deliveryPackage.count();
    case "DeliveryHandlingRequirement":
      return client.deliveryHandlingRequirement.count();
    case "DeliveryCompliance":
      return client.deliveryCompliance.count();
    case "DeliverySchedule":
      return client.deliverySchedule.count();
    case "DeliveryPickup":
      return client.deliveryPickup.count();
    case "DeliveryDrop":
      return client.deliveryDrop.count();
    case "DeliveryRating":
      return client.deliveryRating.count();
    case "DeliveryFeedback":
      return client.deliveryFeedback.count();
    case "Delivery":
      return client.delivery.count();
    case "ProviderWebhookEvent":
      return client.providerWebhookEvent.count();
    case "ProviderCredential":
      return client.providerCredential.count();
    case "ProviderCapabilityRecord":
      return client.providerCapabilityRecord.count();
    case "ProviderService":
      return client.providerService.count();
    case "ProviderVehicle":
      return client.providerVehicle.count();
    case "ProviderSettings":
      return client.providerSettings.count();
    case "ProviderPackageLimits":
      return client.providerPackageLimits.count();
    case "Provider":
      return client.provider.count();
    case "AdminAuditLog":
      return client.adminAuditLog.count();
    case "OAuthAccount":
      return client.oAuthAccount.count();
    case "EmailVerificationOtp":
      return client.emailVerificationOtp.count();
    case "PasswordResetOtp":
      return client.passwordResetOtp.count();
    case "PasswordResetVerificationToken":
      return client.passwordResetVerificationToken.count();
    case "RefreshToken":
      return client.refreshToken.count();
    case "User":
      return client.user.count();
    default: {
      const exhaustive: never = model;
      throw new Error(`Unhandled model: ${exhaustive}`);
    }
  }
}

async function deleteModel(
  tx: TransactionClient,
  model: ApplicationModelName,
): Promise<number> {
  switch (model) {
    case "CancellationIdempotencyKey":
      return (await tx.cancellationIdempotencyKey.deleteMany()).count;
    case "DeliveryCancellation":
      return (await tx.deliveryCancellation.deleteMany()).count;
    case "DeliveryTrackingPoint":
      return (await tx.deliveryTrackingPoint.deleteMany()).count;
    case "DeliveryOtp":
      return (await tx.deliveryOtp.deleteMany()).count;
    case "DriverAssignment":
      return (await tx.driverAssignment.deleteMany()).count;
    case "BookingConfirmIdempotencyKey":
      return (await tx.bookingConfirmIdempotencyKey.deleteMany()).count;
    case "ProviderBooking":
      return (await tx.providerBooking.deleteMany()).count;
    case "OrchestrationOption":
      return (await tx.orchestrationOption.deleteMany()).count;
    case "OrchestrationEvaluation":
      return (await tx.orchestrationEvaluation.deleteMany()).count;
    case "OrchestrationRequest":
      return (await tx.orchestrationRequest.deleteMany()).count;
    case "DeliveryIdempotencyKey":
      return (await tx.deliveryIdempotencyKey.deleteMany()).count;
    case "DeliveryStatusEvent":
      return (await tx.deliveryStatusEvent.deleteMany()).count;
    case "DeliveryPackagePhoto":
      return (await tx.deliveryPackagePhoto.deleteMany()).count;
    case "DeliveryPackage":
      return (await tx.deliveryPackage.deleteMany()).count;
    case "DeliveryHandlingRequirement":
      return (await tx.deliveryHandlingRequirement.deleteMany()).count;
    case "DeliveryCompliance":
      return (await tx.deliveryCompliance.deleteMany()).count;
    case "DeliverySchedule":
      return (await tx.deliverySchedule.deleteMany()).count;
    case "DeliveryPickup":
      return (await tx.deliveryPickup.deleteMany()).count;
    case "DeliveryDrop":
      return (await tx.deliveryDrop.deleteMany()).count;
    case "DeliveryRating":
      return (await tx.deliveryRating.deleteMany()).count;
    case "DeliveryFeedback":
      return (await tx.deliveryFeedback.deleteMany()).count;
    case "Delivery":
      return (await tx.delivery.deleteMany()).count;
    case "ProviderWebhookEvent":
      return (await tx.providerWebhookEvent.deleteMany()).count;
    case "ProviderCredential":
      return (await tx.providerCredential.deleteMany()).count;
    case "ProviderCapabilityRecord":
      return (await tx.providerCapabilityRecord.deleteMany()).count;
    case "ProviderService":
      return (await tx.providerService.deleteMany()).count;
    case "ProviderVehicle":
      return (await tx.providerVehicle.deleteMany()).count;
    case "ProviderSettings":
      return (await tx.providerSettings.deleteMany()).count;
    case "ProviderPackageLimits":
      return (await tx.providerPackageLimits.deleteMany()).count;
    case "Provider":
      return (await tx.provider.deleteMany()).count;
    case "AdminAuditLog":
      return (await tx.adminAuditLog.deleteMany()).count;
    case "OAuthAccount":
      return (await tx.oAuthAccount.deleteMany()).count;
    case "EmailVerificationOtp":
      return (await tx.emailVerificationOtp.deleteMany()).count;
    case "PasswordResetOtp":
      return (await tx.passwordResetOtp.deleteMany()).count;
    case "PasswordResetVerificationToken":
      return (await tx.passwordResetVerificationToken.deleteMany()).count;
    case "RefreshToken":
      return (await tx.refreshToken.deleteMany()).count;
    case "User":
      return (await tx.user.deleteMany()).count;
    default: {
      const exhaustive: never = model;
      throw new Error(`Unhandled model: ${exhaustive}`);
    }
  }
}

export async function collectApplicationModelCounts(
  client: CountableClient | TransactionClient,
): Promise<ModelCountEntry[]> {
  const entries: ModelCountEntry[] = [];
  for (const model of APPLICATION_MODELS) {
    entries.push({ model, count: await countModel(client, model) });
  }
  return entries;
}

export async function deleteApplicationData(
  prisma: PrismaClient,
): Promise<Record<ApplicationModelName, number>> {
  const deleted: Partial<Record<ApplicationModelName, number>> = {};

  // Ordered deleteMany without one long interactive transaction.
  // Supabase pooler / remote Postgres often closes long transactions before
  // all 37 models finish; FK-safe order still prevents constraint violations.
  for (const model of DELETION_ORDER) {
    deleted[model] = await deleteModel(prisma, model);
  }

  return deleted as Record<ApplicationModelName, number>;
}

export type DeliverySequenceState = {
  lastValue: number;
  isCalled: boolean;
  nextReference: string;
};

export async function readDeliveryReferenceSequence(
  prisma: PrismaClient,
): Promise<DeliverySequenceState> {
  const rows = await prisma.$queryRaw<
    Array<{ last_value: bigint | number; is_called: boolean }>
  >`SELECT last_value, is_called FROM delivery_reference_seq`;

  const row = rows[0];
  const lastValue = Number(row?.last_value ?? 0);
  const isCalled = Boolean(row?.is_called);
  const nextNumeric = isCalled ? lastValue + 1 : lastValue;

  return {
    lastValue,
    isCalled,
    nextReference: `DUTT-${nextNumeric}`,
  };
}

export async function resetDeliveryReferenceSequence(
  prisma: PrismaClient,
  restartWith = 1000,
): Promise<DeliverySequenceState> {
  await prisma.$executeRawUnsafe(
    `ALTER SEQUENCE delivery_reference_seq RESTART WITH ${restartWith}`,
  );
  return readDeliveryReferenceSequence(prisma);
}

export type DatabaseDataResetResult = {
  database: SafeDatabaseIdentification;
  before: ModelCountEntry[];
  deleted: Record<ApplicationModelName, number>;
  after: ModelCountEntry[];
  sequence: DeliverySequenceState;
  adminSeed: AdminSeedResult;
};

export function formatModelCounts(entries: ModelCountEntry[]): string {
  return entries.map(({ model, count }) => `${model}: ${count}`).join("\n");
}

export async function runDatabaseDataReset(
  prisma: PrismaClient,
  databaseUrl: string,
): Promise<DatabaseDataResetResult> {
  const database = parseSafeDatabaseIdentification(databaseUrl);
  const before = await collectApplicationModelCounts(prisma);
  const deleted = await deleteApplicationData(prisma);
  const sequence = await resetDeliveryReferenceSequence(prisma);
  const adminSeed = await provisionAdminUser(prisma);
  const after = await collectApplicationModelCounts(prisma);

  return {
    database,
    before,
    deleted,
    after,
    sequence,
    adminSeed,
  };
}
