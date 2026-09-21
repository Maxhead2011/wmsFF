-- FIX: additive relation; existing requests retain NULL and unchanged behavior.
ALTER TABLE "ClientRequest" ADD COLUMN "parentRequestId" TEXT;
ALTER TABLE "ClientRequest" ADD COLUMN "fboRequestCode" TEXT;
ALTER TABLE "ClientRequest" ADD COLUMN "fboRemainderSequence" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "ClientRequest_fboRequestCode_key" ON "ClientRequest"("fboRequestCode");
CREATE INDEX "ClientRequest_parentRequestId_idx" ON "ClientRequest"("parentRequestId");
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_parentRequestId_fkey"
  FOREIGN KEY ("parentRequestId") REFERENCES "ClientRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
