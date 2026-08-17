BEGIN;

DO $$
DECLARE
  moscow_id text;
BEGIN
  SELECT id
    INTO moscow_id
    FROM "Warehouse"
   WHERE code = 'MSK'
   LIMIT 1;

  IF moscow_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse MSK was not found';
  END IF;

  UPDATE "WarehouseClient"
     SET status = 'ACTIVE',
         source = COALESCE(NULLIF(source, ''), 'LOCAL'),
         "activatedAt" = COALESCE("activatedAt", "createdAt"),
         "updatedAt" = now();

  INSERT INTO "WarehouseClient" (
    "warehouseId",
    "clientId",
    status,
    source,
    "activatedAt",
    "createdAt",
    "updatedAt"
  )
  SELECT
    moscow_id,
    c.id,
    'ACTIVE',
    'LOCAL',
    now(),
    now(),
    now()
  FROM "Client" c
  WHERE c."isDemo" = false
  ON CONFLICT ("warehouseId", "clientId")
  DO UPDATE SET
    status = 'ACTIVE',
    source = COALESCE(NULLIF("WarehouseClient".source, ''), 'LOCAL'),
    "activatedAt" = COALESCE("WarehouseClient"."activatedAt", now()),
    "updatedAt" = now();

  UPDATE "ClientContract"
     SET "warehouseId" = moscow_id
   WHERE "warehouseId" IS NULL;
END
$$;

COMMIT;
