-- TEST: synthetic isolated database only; no production data or connection string.
CREATE TABLE "Client" (id TEXT PRIMARY KEY);
CREATE TABLE "Warehouse" (id TEXT PRIMARY KEY);
CREATE TABLE "User" (id TEXT PRIMARY KEY);
CREATE TABLE "BillingInvoice" (id TEXT PRIMARY KEY, "clientId" TEXT, "warehouseId" TEXT, "totalRub" NUMERIC(14,2), "paidRub" NUMERIC(14,2), status TEXT, "issuedAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3));
CREATE TABLE "BillingInvoiceItem" (id TEXT PRIMARY KEY, "invoiceId" TEXT REFERENCES "BillingInvoice"(id), "totalRub" NUMERIC(14,2));
INSERT INTO "Client" VALUES ('c'); INSERT INTO "Warehouse" VALUES ('w'); INSERT INTO "User" VALUES ('u');
INSERT INTO "BillingInvoice" VALUES ('i','c','w',100,45,'ISSUED',NOW(),NULL,NOW()),('late','c','w',50,0,'DRAFT',NULL,NULL,NOW());
INSERT INTO "BillingInvoiceItem" VALUES ('item','i',100);
