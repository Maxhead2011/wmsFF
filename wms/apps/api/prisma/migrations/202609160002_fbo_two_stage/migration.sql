-- FIX: additive, opt-in FBO ledger; no stock or historical requests are rewritten.
CREATE TABLE "FboAssembly" (
  "requestId" TEXT NOT NULL, "phase" TEXT NOT NULL DEFAULT 'PICKING', "compositionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FboAssembly_pkey" PRIMARY KEY ("requestId"),
  CONSTRAINT "FboAssembly_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "FboAssemblyUnit" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestItemId" TEXT NOT NULL, "skuId" TEXT NOT NULL,
  "barcode" TEXT NOT NULL, "markId" TEXT, "activeMarkId" TEXT, "kiz" TEXT, "sourceBoxId" TEXT NOT NULL,
  "sourceBoxCode" TEXT NOT NULL, "wholeBox" BOOLEAN NOT NULL DEFAULT false, "state" TEXT NOT NULL DEFAULT 'PICKED',
  "targetBoxId" TEXT, "targetBoxCode" TEXT, "pickedByUserId" TEXT NOT NULL, "packedByUserId" TEXT,
  "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "packedAt" TIMESTAMP(3),
  CONSTRAINT "FboAssemblyUnit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FboAssemblyUnit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FboAssembly"("requestId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FboAssemblyUnit_activeMarkId_key" ON "FboAssemblyUnit"("activeMarkId");
CREATE INDEX "FboAssemblyUnit_requestId_state_idx" ON "FboAssemblyUnit"("requestId", "state");
CREATE INDEX "FboAssemblyUnit_sourceBoxId_state_idx" ON "FboAssemblyUnit"("sourceBoxId", "state");
CREATE INDEX "FboAssemblyUnit_targetBoxId_state_idx" ON "FboAssemblyUnit"("targetBoxId", "state");
CREATE TABLE "FboAssemblyAction" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FboAssemblyAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FboAssemblyAction_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FboAssembly"("requestId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FboAssemblyAction_requestId_createdAt_idx" ON "FboAssemblyAction"("requestId", "createdAt");
CREATE TABLE "FboAssemblyBox" (
  "id" TEXT NOT NULL, "requestId" TEXT NOT NULL, "boxId" TEXT NOT NULL, "activeBoxId" TEXT, "boxCode" TEXT NOT NULL,
  "wholeBox" BOOLEAN NOT NULL DEFAULT false, "closedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3), "confirmedByUserId" TEXT,
  CONSTRAINT "FboAssemblyBox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FboAssemblyBox_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FboAssembly"("requestId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FboAssemblyBox_activeBoxId_key" ON "FboAssemblyBox"("activeBoxId");
CREATE INDEX "FboAssemblyBox_boxId_idx" ON "FboAssemblyBox"("boxId");
CREATE UNIQUE INDEX "FboAssemblyBox_requestId_boxCode_key" ON "FboAssemblyBox"("requestId", "boxCode");
