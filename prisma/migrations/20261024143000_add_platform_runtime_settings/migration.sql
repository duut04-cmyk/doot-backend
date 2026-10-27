-- CreateEnum
CREATE TYPE "PlatformRuntimeSettingKey" AS ENUM ('BOOKING_QUOTE_MAX_AGE_SECONDS', 'BOOKING_PRICE_TOLERANCE_PERCENT');

-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'PLATFORM_RUNTIME_SETTING_UPDATED';

-- AlterEnum
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PLATFORM_RUNTIME_SETTING';

-- CreateTable
CREATE TABLE "PlatformRuntimeSetting" (
    "key" "PlatformRuntimeSettingKey" NOT NULL,
    "intValue" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformRuntimeSetting_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "PlatformRuntimeSetting" ADD CONSTRAINT "PlatformRuntimeSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
