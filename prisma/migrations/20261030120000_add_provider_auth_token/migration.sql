-- CreateEnum
CREATE TYPE "ProviderAuthTokenRefreshStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ProviderAuthToken" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3),
    "refreshLeaseToken" TEXT,
    "refreshLeaseUntil" TIMESTAMP(3),
    "lastRefreshStatus" "ProviderAuthTokenRefreshStatus",
    "lastRefreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAuthToken_providerId_key" ON "ProviderAuthToken"("providerId");

-- CreateIndex
CREATE INDEX "ProviderAuthToken_expiresAt_idx" ON "ProviderAuthToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProviderAuthToken" ADD CONSTRAINT "ProviderAuthToken_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
