# Telegram for automatic FBS request statuses

Fixes missing client Telegram notifications after automatic status changes. The transaction collects only actual transitions; sending happens after commit through the existing TelegramNotificationService, using the client's configured chat and FBS section. A rollback or duplicate scan does not send. The feature remains off when WMS_FBS_REQUEST_AUTO_STATUS_ENABLED is off. Telegram errors do not undo committed warehouse work. Historical notifications are not replayed.

The server overlay preserves newer production changes. Only the status helper, marketplace service and module registration change; no schema migration or web release. The release preflight checks every other source/compiled file remains unchanged.

Validation: 22 focused integration tests passed locally; regression reproduced before the fix; API TypeScript passed. Final full-suite and server-overlay results are recorded with the release under /opt/logoff-wms-releases/fbs-telegram-20260924.

Final validation on 24 September 2026: 2749 tests passed across 233 files; 60 tests skipped (2 files entirely). All 22 focused integration tests also passed on the production source overlay in isolated PostgreSQL. API TypeScript compilation and image preflight passed. Only the three intended source modules and their compiled JavaScript differ. The release uses one added filesystem layer containing these six files to avoid Docker's overlay mount limit; existing environment and image configuration are preserved.
