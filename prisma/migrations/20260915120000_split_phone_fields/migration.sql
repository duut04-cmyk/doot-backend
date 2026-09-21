-- Split single phone fields into countryCode + nationalNumber components.
-- Existing E.164 values are not backfilled in SQL; database cleanup follows separately.

ALTER TABLE "User" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "User" ADD COLUMN "phoneCountryCode" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;

ALTER TABLE "DeliveryPickup" DROP COLUMN IF EXISTS "contactPhone";
ALTER TABLE "DeliveryPickup" ADD COLUMN "contactPhoneCountryCode" TEXT NOT NULL DEFAULT '+91';
ALTER TABLE "DeliveryPickup" ADD COLUMN "contactPhoneNumber" TEXT NOT NULL DEFAULT '0000000000';
ALTER TABLE "DeliveryPickup" ALTER COLUMN "contactPhoneCountryCode" DROP DEFAULT;
ALTER TABLE "DeliveryPickup" ALTER COLUMN "contactPhoneNumber" DROP DEFAULT;

ALTER TABLE "DeliveryDrop" DROP COLUMN IF EXISTS "contactPhone";
ALTER TABLE "DeliveryDrop" ADD COLUMN "contactPhoneCountryCode" TEXT NOT NULL DEFAULT '+91';
ALTER TABLE "DeliveryDrop" ADD COLUMN "contactPhoneNumber" TEXT NOT NULL DEFAULT '0000000000';
ALTER TABLE "DeliveryDrop" ALTER COLUMN "contactPhoneCountryCode" DROP DEFAULT;
ALTER TABLE "DeliveryDrop" ALTER COLUMN "contactPhoneNumber" DROP DEFAULT;

ALTER TABLE "DriverAssignment" DROP COLUMN IF EXISTS "driverPhone";
ALTER TABLE "DriverAssignment" ADD COLUMN "driverPhoneCountryCode" TEXT;
ALTER TABLE "DriverAssignment" ADD COLUMN "driverPhoneNumber" TEXT;
