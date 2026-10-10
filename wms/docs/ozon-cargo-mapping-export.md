# Correspondence of WMS boxes and Ozon cargoes

Prepared on branch `fix/ozon-cargo-mapping-export`; not yet published.

After all destination operations return SUCCESS, the Ozon assembly panel offers
“Скачать соответствия коробов (Excel)”. The workbook includes the WMS box code,
destination, Ozon cargo ID, supply ID and order number. It remains downloadable
after reopening the assembly. No automatic browser download or remote write occurs.

GET `ozon-fbo-import/requests/:id/supply/cargo-mapping.xlsx` applies the existing
feature, client and warehouse access checks. Export joins receipt `key` to
`FboAssemblyBox.id`, checks direction/supply ownership and one-to-one coverage,
rejects pending, unknown, missing, duplicate or foreign receipts, and sorts by WMS
box code. All identifiers are Excel text cells, avoiding numeric rounding.

This does not change cargo sending, rate limiting, stock, picking, labels or TSD.
Our-WMS release only; sold WMS is outside the deployment scope.
