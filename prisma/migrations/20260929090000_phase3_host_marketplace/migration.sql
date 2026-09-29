-- CreateEnum
CREATE TYPE "HostType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- AlterEnum (rename keeps existing data; replaces generated drop/recreate)
ALTER TYPE "ComplianceStatus" RENAME VALUE 'PENDING_REVIEW' TO 'UNDER_REVIEW';

-- AlterEnum
ALTER TYPE "PropertyStatus" ADD VALUE 'CHANGES_REQUESTED';

-- AlterEnum
ALTER TYPE "PropertyType" ADD VALUE 'HOUSE';
ALTER TYPE "PropertyType" ADD VALUE 'GUESTHOUSE';

-- AlterTable
ALTER TABLE "HostProfile" ADD COLUMN     "abn" TEXT,
ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "hostType" "HostType" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "legalName" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "completedSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "eventsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "petsAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quietHoursEnd" TEXT,
ADD COLUMN     "quietHoursStart" TEXT,
ADD COLUMN     "smokingAllowed" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "destinationId" DROP NOT NULL,
ALTER COLUMN "summary" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "addressLine1" DROP NOT NULL,
ALTER COLUMN "locality" DROP NOT NULL,
ALTER COLUMN "latitude" DROP NOT NULL,
ALTER COLUMN "longitude" DROP NOT NULL,
ALTER COLUMN "nightlyPriceCents" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: a listing that is submitted, live, paused or suspended must be complete.
-- Drafts (and listings sent back to the host) may be partial. This backs up the application's
-- submission checklist at the database level, so incomplete data can never go public.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Property" ADD CONSTRAINT "Property_listable_complete_check" CHECK (
  "status" IN ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED')
  OR (
    "summary" IS NOT NULL AND "description" IS NOT NULL AND "addressLine1" IS NOT NULL
    AND "locality" IS NOT NULL AND "adminArea" IS NOT NULL AND "destinationId" IS NOT NULL
    AND "nightlyPriceCents" IS NOT NULL
  )
);

-- Coordinates, when present, must be real-world values.
ALTER TABLE "Property" ADD CONSTRAINT "Property_coordinates_check" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
