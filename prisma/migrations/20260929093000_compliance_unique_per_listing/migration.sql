-- DropIndex
DROP INDEX "ComplianceDocument_propertyId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDocument_propertyId_type_key" ON "ComplianceDocument"("propertyId", "type");

