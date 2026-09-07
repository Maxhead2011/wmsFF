-- ADDED: additive storage only. Existing boxes, balances and requests are untouched.
CREATE TABLE "PalletSortingSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warehouseId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PalletSortingSession_warehouseId_completedAt_idx" ON "PalletSortingSession" ("warehouseId", "completedAt");
CREATE INDEX "PalletSortingSession_clientId_idx" ON "PalletSortingSession" ("clientId");
