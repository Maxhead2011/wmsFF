-- FIX: additive relation; no inventory changes.
CREATE TABLE "LamodaFboAssembly" (
 "requestId" TEXT NOT NULL PRIMARY KEY,
 "planId" TEXT NOT NULL,
 "externalKey" TEXT,
 "directions" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LamodaFboAssembly_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "LamodaFboAssembly_planId_fkey" FOREIGN KEY ("planId") REFERENCES "LamodaPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LamodaFboAssembly_planId_key" ON "LamodaFboAssembly"("planId");
CREATE UNIQUE INDEX "LamodaFboAssembly_externalKey_key" ON "LamodaFboAssembly"("externalKey");
