-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "importBatchId" TEXT;

-- CreateIndex
CREATE INDEX "Patient_importBatchId_idx" ON "Patient"("importBatchId");
