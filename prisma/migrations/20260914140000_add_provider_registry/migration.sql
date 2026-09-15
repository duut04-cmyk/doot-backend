-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "ProviderEnvironment" AS ENUM ('SANDBOX', 'LIVE');
CREATE TYPE "ProviderIntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'READY', 'ERROR');
CREATE TYPE "ProviderHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'UNHEALTHY');
CREATE TYPE "ProviderCapability" AS ENUM (
  'SERVICEABILITY', 'AVAILABILITY', 'PRICING', 'BOOKING', 'DRIVER_INFO',
  'DRIVER_RATING', 'VEHICLE_INFO', 'LIVE_TRACKING', 'TRACKING_URL',
  'WEBHOOKS', 'OTP', 'CANCELLATION'
);
CREATE TYPE "ProviderServiceType" AS ENUM (
  'BIKE', 'SCOOTER', 'CAR', 'VAN', 'TRUCK',
  'HYPERLOCAL', 'SAME_DAY', 'EXPRESS', 'SCHEDULED'
);
CREATE TYPE "ProviderVehicleType" AS ENUM ('BIKE', 'SCOOTER', 'CAR', 'VAN', 'TRUCK');
CREATE TYPE "ProviderCredentialField" AS ENUM (
  'API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET',
  'USERNAME', 'PASSWORD', 'ACCOUNT_ID', 'WEBHOOK_SECRET'
);
CREATE TYPE "AdminAuditAction" AS ENUM (
  'PROVIDER_CREATED', 'PROVIDER_UPDATED', 'PROVIDER_ENABLED', 'PROVIDER_DISABLED',
  'PROVIDER_STATUS_CHANGED', 'PROVIDER_CREDENTIALS_UPDATED', 'PROVIDER_CAPABILITIES_UPDATED',
  'PROVIDER_SERVICE_CREATED', 'PROVIDER_SERVICE_UPDATED', 'PROVIDER_SERVICE_DISABLED',
  'PROVIDER_VEHICLE_CREATED', 'PROVIDER_VEHICLE_UPDATED'
);
CREATE TYPE "AdminAuditResourceType" AS ENUM (
  'PROVIDER', 'PROVIDER_SERVICE', 'PROVIDER_VEHICLE', 'PROVIDER_CREDENTIALS', 'PROVIDER_CAPABILITIES'
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "status" "ProviderStatus" NOT NULL DEFAULT 'INACTIVE',
    "environment" "ProviderEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "orchestrationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "integrationStatus" "ProviderIntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "healthStatus" "ProviderHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderSettings" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "connectTimeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "retryDelayMs" INTEGER NOT NULL DEFAULT 1000,
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "healthCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "healthCheckIntervalMs" INTEGER NOT NULL DEFAULT 300000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderPackageLimits" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "minWeightKg" DECIMAL(10,3),
    "maxWeightKg" DECIMAL(10,3),
    "maxLengthCm" DECIMAL(10,2),
    "maxWidthCm" DECIMAL(10,2),
    "maxHeightCm" DECIMAL(10,2),
    "maxVolumeCm3" DECIMAL(14,2),
    "supportedPackageTypes" "PackageType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderPackageLimits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCredential" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "fieldName" "ProviderCredentialField" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderCapabilityRecord" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "capability" "ProviderCapability" NOT NULL,
    CONSTRAINT "ProviderCapabilityRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderService" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceType" "ProviderServiceType" NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderVehicle" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "vehicleType" "ProviderVehicleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxWeightKg" DECIMAL(10,3),
    "maxLengthCm" DECIMAL(10,2),
    "maxWidthCm" DECIMAL(10,2),
    "maxHeightCm" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderVehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "action" "AdminAuditAction" NOT NULL,
    "resourceType" "AdminAuditResourceType" NOT NULL,
    "resourceId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Provider_code_key" ON "Provider"("code");
CREATE INDEX "Provider_status_idx" ON "Provider"("status");
CREATE INDEX "Provider_enabled_idx" ON "Provider"("enabled");
CREATE INDEX "Provider_orchestrationEnabled_idx" ON "Provider"("orchestrationEnabled");
CREATE INDEX "Provider_priority_idx" ON "Provider"("priority");
CREATE UNIQUE INDEX "ProviderSettings_providerId_key" ON "ProviderSettings"("providerId");
CREATE UNIQUE INDEX "ProviderPackageLimits_providerId_key" ON "ProviderPackageLimits"("providerId");
CREATE INDEX "ProviderCredential_providerId_idx" ON "ProviderCredential"("providerId");
CREATE INDEX "ProviderCredential_providerId_isActive_idx" ON "ProviderCredential"("providerId", "isActive");
CREATE UNIQUE INDEX "ProviderCapabilityRecord_providerId_capability_key" ON "ProviderCapabilityRecord"("providerId", "capability");
CREATE INDEX "ProviderCapabilityRecord_providerId_idx" ON "ProviderCapabilityRecord"("providerId");
CREATE UNIQUE INDEX "ProviderService_providerId_code_key" ON "ProviderService"("providerId", "code");
CREATE INDEX "ProviderService_providerId_idx" ON "ProviderService"("providerId");
CREATE INDEX "ProviderService_providerId_enabled_idx" ON "ProviderService"("providerId", "enabled");
CREATE UNIQUE INDEX "ProviderVehicle_providerId_vehicleType_key" ON "ProviderVehicle"("providerId", "vehicleType");
CREATE INDEX "ProviderVehicle_providerId_idx" ON "ProviderVehicle"("providerId");
CREATE INDEX "AdminAuditLog_adminUserId_idx" ON "AdminAuditLog"("adminUserId");
CREATE INDEX "AdminAuditLog_resourceType_resourceId_idx" ON "AdminAuditLog"("resourceType", "resourceId");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- ForeignKeys
ALTER TABLE "ProviderSettings" ADD CONSTRAINT "ProviderSettings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderPackageLimits" ADD CONSTRAINT "ProviderPackageLimits_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderCapabilityRecord" ADD CONSTRAINT "ProviderCapabilityRecord_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderService" ADD CONSTRAINT "ProviderService_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderVehicle" ADD CONSTRAINT "ProviderVehicle_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
