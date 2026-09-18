-- FIX: build without blocking warehouse writes; inventory history and stock are unchanged.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_entityId_action_createdAt_idx"
ON "AuditLog" ("entityId", "action", "createdAt");
