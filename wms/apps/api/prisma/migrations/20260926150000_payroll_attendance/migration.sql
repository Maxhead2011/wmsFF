-- CreateTable
CREATE TABLE "PayrollEmployee" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "picker" BOOLEAN NOT NULL DEFAULT true,
    "loader" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "paymentPhone" TEXT,
    "paymentBank" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCondition" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rateKopecks" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "temporary" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollShift" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "workDate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startPhoto" TEXT,
    "endPhoto" TEXT,
    "createdById" TEXT NOT NULL,
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollHandling" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "operation" TEXT NOT NULL,
    "palletCount" DECIMAL(12,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollHandling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollHandlingShare" (
    "operationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amountKopecks" INTEGER,

    CONSTRAINT "PayrollHandlingShare_pkey" PRIMARY KEY ("operationId","employeeId")
);

-- CreateTable
CREATE TABLE "PayrollAudit" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettlement" (
    "key" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "comment" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettlement_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PayrollHistorical" (
    "key" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "amountKopecks" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollHistorical_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEmployee_userId_key" ON "PayrollEmployee"("userId");

-- CreateIndex
CREATE INDEX "PayrollEmployee_warehouseId_isDemo_isActive_idx" ON "PayrollEmployee"("warehouseId", "isDemo", "isActive");

-- CreateIndex
CREATE INDEX "PayrollCondition_employeeId_kind_startsAt_idx" ON "PayrollCondition"("employeeId", "kind", "startsAt");

-- CreateIndex
CREATE INDEX "PayrollShift_employeeId_workDate_idx" ON "PayrollShift"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "PayrollHandling_warehouseId_startsAt_idx" ON "PayrollHandling"("warehouseId", "startsAt");

-- CreateIndex
CREATE INDEX "PayrollAudit_warehouseId_entityId_createdAt_idx" ON "PayrollAudit"("warehouseId", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollSettlement_employeeId_workDate_idx" ON "PayrollSettlement"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "PayrollHistorical_employeeId_workDate_idx" ON "PayrollHistorical"("employeeId", "workDate");

-- AddForeignKey
ALTER TABLE "PayrollCondition" ADD CONSTRAINT "PayrollCondition_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollShift" ADD CONSTRAINT "PayrollShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollHandlingShare" ADD CONSTRAINT "PayrollHandlingShare_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PayrollHandling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollHandlingShare" ADD CONSTRAINT "PayrollHandlingShare_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
