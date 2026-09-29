-- The listable-complete check no longer requires "adminArea" (state/territory): not every country
-- has one. Jurisdiction-specific requirements (e.g. an Australian state for STRA compliance) are
-- enforced by the application's submission checklist instead.
ALTER TABLE "Property" DROP CONSTRAINT "Property_listable_complete_check";
ALTER TABLE "Property" ADD CONSTRAINT "Property_listable_complete_check" CHECK (
  "status" IN ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'ARCHIVED')
  OR (
    "summary" IS NOT NULL AND "description" IS NOT NULL AND "addressLine1" IS NOT NULL
    AND "locality" IS NOT NULL AND "destinationId" IS NOT NULL AND "nightlyPriceCents" IS NOT NULL
  )
);
