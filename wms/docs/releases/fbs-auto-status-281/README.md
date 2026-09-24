# FBS automatic status release 281

The production API contains newer physical-pick confirmation, Ozon and stock safeguards than the PR base. The user approved combining the changes. `server-overlay.patch` records the precise service integration on the current production source; `source-hashes.json` records the source before and after. The new helper is identical to the PR module.

Only the service and helper source/compiled output are included in the API image overlay. Other API modules, Prisma schema/client and web remain unchanged. The feature flag `WMS_FBS_REQUEST_AUTO_STATUS_ENABLED=true` is enabled only for our WMS. No migration is required.

Local validation: 2746 passing API tests, 60 skipped; database-specific suites run separately. The final server overlay is compiled and its 19 integration scenarios run against isolated PostgreSQL before switching the image. Release guards require an unchanged base image and preserve all other environment values. Rollback retains the previous image and environment.

Current request reconciliation on 24 September: checked 74 open FBS requests, changed 7 to IN_WORK and 14 to PACKED, none to DONE. Later manual statuses and changed requests are protected. Original values and resulting status events are backed up outside the API container at `/opt/logoff-wms-releases/fbs-auto-status-20260924/backfill-backup`. No inventory changes or marketplace calls were made by reconciliation.
