-- FIX: additive empty configuration table; no changes to old client tariffs or financial documents.
CREATE TABLE "ClientFboProcessingTariff" (
 "id" TEXT NOT NULL,
 "clientId" TEXT NOT NULL,
 "operationKey" TEXT NOT NULL,
 "definition" JSONB NOT NULL,
 "definitionHash" TEXT NOT NULL,
 "createdByUserId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ClientFboProcessingTariff_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ClientFboProcessingTariff_definition_object" CHECK (jsonb_typeof("definition")='object'),
 CONSTRAINT "ClientFboProcessingTariff_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ClientFboProcessingTariff_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClientFboProcessingTariff_clientId_key" ON "ClientFboProcessingTariff"("clientId");
CREATE UNIQUE INDEX "ClientFboProcessingTariff_operationKey_key" ON "ClientFboProcessingTariff"("operationKey");
CREATE FUNCTION "keep_fbo_processing_tariff"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FBO processing tariff snapshots cannot be overwritten or deleted'; END;
$$;
CREATE TRIGGER "keep_fbo_processing_tariff" BEFORE UPDATE OR DELETE ON "ClientFboProcessingTariff"
 FOR EACH ROW EXECUTE FUNCTION "keep_fbo_processing_tariff"();
