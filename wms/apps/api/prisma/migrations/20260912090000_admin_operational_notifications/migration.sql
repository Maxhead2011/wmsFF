-- FIX: additive migration; no changes to stock or existing client notifications.
CREATE TABLE "AdminNotification" (
  "id" SERIAL PRIMARY KEY, "type" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL, "clientId" TEXT NOT NULL, "warehouseId" TEXT,
  "actorId" TEXT NOT NULL, "actorName" TEXT NOT NULL, "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "sessionId" TEXT, "auditBoxId" TEXT, "requestId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AdminNotification_dedupeKey_key" ON "AdminNotification"("dedupeKey");
CREATE INDEX "AdminNotification_clientId_id_idx" ON "AdminNotification"("clientId", "id");
CREATE INDEX "AdminNotification_warehouseId_id_idx" ON "AdminNotification"("warehouseId", "id");
CREATE TABLE "AdminNotificationReceipt" (
  "notificationId" INTEGER NOT NULL, "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3), "popupShownAt" TIMESTAMP(3),
  CONSTRAINT "AdminNotificationReceipt_pkey" PRIMARY KEY ("notificationId", "userId"),
  CONSTRAINT "AdminNotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AdminNotificationReceipt_userId_readAt_idx" ON "AdminNotificationReceipt"("userId", "readAt");
