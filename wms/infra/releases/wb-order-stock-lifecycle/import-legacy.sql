-- FIX: promote only rehearsed, unchanged historical shipment evidence; never stock movements or invoices.
INSERT INTO "WbOrderShipment"
SELECT f.*
FROM jsonb_array_elements($1::jsonb) AS payload(row)
CROSS JOIN LATERAL jsonb_populate_record(NULL::"WbOrderShipment", payload.row->'fact') f
JOIN "FbsTsdAssembly" t ON t.id=f."assemblyId"
JOIN "ShippedKizHistory" h ON h."assemblyId"=f."assemblyId"
WHERE f.source='LEGACY_WMS_SHIPMENT'
  AND f.quantity>0 AND f.quantity=t."itemCount"
  AND f."clientId"=t."clientId" AND f."requestId"=t."requestId"
  AND f."connectionId"=t."connectionId" AND f."orderId"=t."orderId" AND f."skuId"=t."skuId"
  AND t."updatedAt"=(f."assemblySnapshot"->>'updatedAt')::timestamp
  AND h."clientId"=f."clientId" AND h."requestId"=f."requestId"
  AND h."skuId"=f."skuId" AND h."orderId"=f."orderId" AND h."warehouseId"=f."warehouseId"
  AND h.kiz=f.kiz AND h."shippedAt"=f."shippedAt"
  AND to_jsonb(h)=payload.row->'history'
ON CONFLICT ("assemblyId") DO NOTHING;
