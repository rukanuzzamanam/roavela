-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PROCESSED', 'IGNORED', 'FAILED');

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "BookingStatus" ADD VALUE 'REFUND_PENDING';

-- DropIndex
DROP INDEX "Payment_bookingId_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancellationPolicy" "CancellationPolicy",
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "houseRulesSnapshot" JSONB,
ADD COLUMN     "pricingSnapshot" JSONB,
ADD COLUMN     "refundDueCents" INTEGER;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL,
    "message" TEXT,
    "paymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_paymentId_idx" ON "WebhookEvent"("paymentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalEventId_key" ON "WebhookEvent"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "Booking_status_expiresAt_idx" ON "Booking"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_provider_key" ON "Payment"("bookingId", "provider");


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written integrity rules
-- ─────────────────────────────────────────────────────────────────────────────

-- Existing PENDING rows (pre-Phase 4) get a hold that has already lapsed, so they stop blocking
-- inventory once the application marks them EXPIRED.
UPDATE "Booking" SET "expiresAt" = "createdAt" + interval '20 minutes'
WHERE "status" = 'PENDING' AND "expiresAt" IS NULL;

-- A booking awaiting payment must say when its hold on the dates ends.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_pending_expiry_check"
  CHECK ("status" <> 'PENDING' OR "expiresAt" IS NOT NULL);

-- The books always balance: what the guest pays = host proceeds + platform gross revenue.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_money_balance_check"
  CHECK ("totalCents" = "hostPayoutCents" + "platformRevenueCents");

-- A refund can never be negative or exceed what was paid.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_refund_range_check"
  CHECK ("refundDueCents" IS NULL OR ("refundDueCents" >= 0 AND "refundDueCents" <= "totalCents"));

-- Payments: positive amounts, refunds within the amount paid.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check"
  CHECK ("amountCents" > 0 AND "refundedCents" >= 0 AND "refundedCents" <= "amountCents");
