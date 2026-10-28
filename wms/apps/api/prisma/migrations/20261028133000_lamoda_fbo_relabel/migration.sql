ALTER TABLE "LamodaFboAssembly" ADD COLUMN "relabelLabels" JSONB;
ALTER TABLE "FboAssemblyUnit" ADD COLUMN "lamodaRelabelPrintId" TEXT,
  ADD COLUMN "lamodaRelabelConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "lamodaRelabelConfirmedBy" TEXT;
