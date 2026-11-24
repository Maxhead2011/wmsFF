-- FIX: separate earned wages, issued advances and their consumption by payments.
CREATE TABLE "PayrollAdvance" (
 "id" TEXT PRIMARY KEY, "employeeId" TEXT NOT NULL REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT,
 "warehouseId" TEXT NOT NULL, "issuedDate" TEXT NOT NULL,
 "amountKopecks" INTEGER NOT NULL CHECK ("amountKopecks">0),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('ADVANCE','OVERPAYMENT')),
 "reason" TEXT NOT NULL, "createdById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "cancelledAt" TIMESTAMP(3)
);
CREATE INDEX "PayrollAdvance_employeeId_issuedDate_idx" ON "PayrollAdvance"("employeeId","issuedDate");
CREATE TABLE "PayrollPaymentRun" (
 "id" TEXT PRIMARY KEY, "requestHash" TEXT NOT NULL, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PayrollAdvanceUse" (
 "id" TEXT PRIMARY KEY, "advanceId" TEXT NOT NULL REFERENCES "PayrollAdvance"("id") ON DELETE RESTRICT,
 "settlementKey" TEXT NOT NULL, "amountKopecks" INTEGER NOT NULL CHECK ("amountKopecks">0),
 "runId" TEXT NOT NULL REFERENCES "PayrollPaymentRun"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reversedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "PayrollAdvanceUse_active_key" ON "PayrollAdvanceUse"("advanceId","settlementKey") WHERE "reversedAt" IS NULL;
CREATE INDEX "PayrollAdvanceUse_settlementKey_idx" ON "PayrollAdvanceUse"("settlementKey");
