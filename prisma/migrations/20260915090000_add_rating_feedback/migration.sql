-- CreateEnum
CREATE TYPE "FeedbackPositiveTag" AS ENUM ('DRIVER_POLITE', 'DRIVER_PROFESSIONAL', 'FAST_DELIVERY', 'EASY_BOOKING', 'GOOD_COMMUNICATION', 'PACKAGE_HANDLED_WELL');
CREATE TYPE "FeedbackIssueTag" AS ENUM ('DRIVER_LATE', 'DRIVER_UNPROFESSIONAL', 'DELIVERY_DELAYED', 'COMMUNICATION_ISSUE', 'PACKAGE_HANDLING_ISSUE', 'TRACKING_ISSUE', 'OTHER');

-- CreateTable
CREATE TABLE "DeliveryRating" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "driverRating" INTEGER NOT NULL,
    "deliveryRating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRating_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryFeedback" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "positiveTags" "FeedbackPositiveTag"[],
    "issueTags" "FeedbackIssueTag"[],
    "comment" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRating_deliveryId_key" ON "DeliveryRating"("deliveryId");
CREATE INDEX "DeliveryRating_customerId_idx" ON "DeliveryRating"("customerId");

CREATE UNIQUE INDEX "DeliveryFeedback_deliveryId_key" ON "DeliveryFeedback"("deliveryId");
CREATE INDEX "DeliveryFeedback_customerId_idx" ON "DeliveryFeedback"("customerId");

-- AddForeignKey
ALTER TABLE "DeliveryRating" ADD CONSTRAINT "DeliveryRating_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryRating" ADD CONSTRAINT "DeliveryRating_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryFeedback" ADD CONSTRAINT "DeliveryFeedback_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryFeedback" ADD CONSTRAINT "DeliveryFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
