-- FIX: durable per-product scan evidence; no existing stock/task is rewritten by migration.
CREATE TABLE "OzonFbsPickState" (
  "assemblyId" TEXT PRIMARY KEY REFERENCES "FbsTsdAssembly"("id") ON DELETE CASCADE,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
