-- FIX: additive durable Lamoda command journal; no stock or existing row changes.
CREATE TABLE "LamodaOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LamodaOperation_status_check" CHECK ("status" IN ('PENDING','SENDING','SUCCEEDED','REJECTED','UNKNOWN')),
  CONSTRAINT "LamodaOperation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LamodaAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LamodaOperation_accountId_operationKey_key" ON "LamodaOperation"("accountId", "operationKey");
CREATE INDEX "LamodaOperation_accountId_status_idx" ON "LamodaOperation"("accountId", "status");
