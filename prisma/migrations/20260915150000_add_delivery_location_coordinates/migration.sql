-- Add optional WGS84 coordinates to pickup/drop locations.
ALTER TABLE "DeliveryPickup" ADD COLUMN "latitude" DECIMAL(10,7);
ALTER TABLE "DeliveryPickup" ADD COLUMN "longitude" DECIMAL(10,7);
ALTER TABLE "DeliveryDrop" ADD COLUMN "latitude" DECIMAL(10,7);
ALTER TABLE "DeliveryDrop" ADD COLUMN "longitude" DECIMAL(10,7);
