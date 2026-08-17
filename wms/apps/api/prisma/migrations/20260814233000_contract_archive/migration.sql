ALTER TABLE "ClientContract" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "ClientContract_archivedAt_idx" ON "ClientContract"("archivedAt");
