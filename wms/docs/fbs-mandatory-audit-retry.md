# Mandatory FBS inventory recovery (request 1291)

The Android screen was stranded when inventory creation/opening failed: activeInventory was null, the mandatory gate hid navigation, and the screen omitted statusMessage. The preliminary dashboard request could fail before opening the inventory. A session id was only saved after its box opened; any unsuccessful getInventory response discarded it and created a replacement.

## Scope

- MainActivity.startMandatoryFbsAuditSession / loadMandatoryFbsAuditSession: LOGOFF-only recoverable loader; sold variants keep the previous path.
- MainActivity.renderInventoryCountScreen: error/loading message and disabled-while-busy retry, with no bypass of mandatory verification.
- MandatoryFbsAuditLoader: persist returned id before opening the box; re-read an existing session and use its already opened box on retry; errors never silently replace it.
- MandatoryFbsAuditLoaderTest and MandatoryFbsAuditScreenTest.

// FIX: the dashboard loads after the required check and its network failure does not make the check unusable.
// TEST: original UI test failed before the change. Tests cover retry/loading UI, preserved box/session on network failure, 403/404/500/503 reads, lost box reply, failed local checkpoint and unchanged sold UI.

No server, database, stock, KIZ or order assignment changes. No automatic acceptance of the unregistered KIZ from order 5848903732. If a saved audit has been deleted, the error remains visible; this change intentionally does not silently invent a new audit.

Release candidate is independently overlaid on the exact Android 208 source in work/fbs1291-audit/android-candidate. No API deployment is needed. Not published by this change.

Branch: fix/fbs-mandatory-audit-retry. PR target for our WMS: fix/historical-packing-client-free-stock. Shared Android files require caution in sold-version merges; execution is gated on logoff flavor.

## Validation

Full Gradle test: repository 178 tests per each of six variants; exact published 208 overlay 211 tests per each of six variants. Zero failures/errors/skips. Original UI test was red before the fix. Logs and verification.json are in work/fbs1291-audit. No physical-device installation or publication yet.
