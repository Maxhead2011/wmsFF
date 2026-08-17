ALTER TABLE "PickWave"
ADD COLUMN "warehouseId" TEXT;

UPDATE "PickWave" AS wave
SET "warehouseId" = scoped."warehouseId"
FROM (
  SELECT link."waveId", MIN(request."warehouseId") AS "warehouseId"
  FROM "PickWaveRequest" AS link
  JOIN "ClientRequest" AS request ON request."id" = link."requestId"
  GROUP BY link."waveId"
  HAVING COUNT(DISTINCT request."warehouseId") = 1
     AND COUNT(*) FILTER (WHERE request."warehouseId" IS NULL) = 0
) AS scoped
WHERE wave."id" = scoped."waveId";

CREATE INDEX "PickWave_warehouseId_status_createdAt_idx"
ON "PickWave"("warehouseId", "status", "createdAt");

ALTER TABLE "PickWave"
ADD CONSTRAINT "PickWave_warehouseId_fkey"
FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
