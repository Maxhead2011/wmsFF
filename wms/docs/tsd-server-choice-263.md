# TSD server-choice 263

Own-WMS update of `pro.logoff.wms.tsd.servers` from261 to263. The ordinary package already offers263; it cannot replace the separate server-choice application. The old server-choice feed correctly reports261 as current, so UPDATE_APP completes without installing anything.

Build from the verified signed server-choice261 APK and transfer only the published ordinary263 FboTwoStageScreen class and its new helper. Preserve every other class except version constants. MainActivity, ReceiptDraftHooks, sessions, outbox, Room schema, update package check and pre-update synchronization remain identical. Preserve all APK resources and application ID, sign with the existing certificate. Do not uninstall, clear data, replay scans or change server sessions.

`apps/android-tsd/servers263/build.py` asserts baseline hashes, exact DEX change scope, resource parity, package/version and signing certificate. `publish.py` requires a merged PR, verifies live baselines under release locks, updates only compatible server-choice JSON/APK routes and rolls back on errors. Main channel and all containers must remain unchanged.

Validation:353 ordinary Android tests and353 server-choice Android tests;8 release tests. Candidate binary verification and physical terminal update results are recorded after publication. A delivered UPDATE_APP command alone is not proof of installation or local outbox contents.

Targeted device verification uses only the owner terminal ending92456568. Before publication it reports261, request3162, and353 non-monitoring server operation records. Capture these records before/after; rely on the preserved updater's pending-operation guard for local unsent scans, and do not claim a physical offline queue inspection without device evidence.
