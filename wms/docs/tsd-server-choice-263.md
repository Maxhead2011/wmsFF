# TSD server-choice 264

Own-WMS update of `pro.logoff.wms.tsd.servers` from261 to264. The ordinary package already offers263; it cannot replace the separate server-choice application. The old server-choice feed correctly reports261 as current, so UPDATE_APP completes without installing anything.

Build from the verified signed server-choice261 APK and transfer only the published ordinary263 FboTwoStageScreen class and its new helper. Preserve every other class except version constants. MainActivity changes only its inlined monitoring version string; ReceiptDraftHooks, sessions, outbox, Room schema, update package check and pre-update synchronization remain identical. Preserve all APK resources and application ID, sign with the existing certificate. Do not uninstall, clear data, replay scans or change server sessions.

`apps/android-tsd/servers263/build.py` asserts baseline hashes, exact DEX change scope, resource parity, package/version and signing certificate. `publish.py` requires a merged PR, verifies live baselines under release locks, updates only compatible server-choice JSON/APK routes and rolls back on errors. Main channel and all containers must remain unchanged.

Validation:353 ordinary Android tests and353 server-choice Android tests;12 release tests. Candidate binary verification and physical terminal update results are recorded after publication. A delivered UPDATE_APP command alone is not proof of installation or local outbox contents.

Targeted device verification uses only the owner terminal ending92456568. Before publication it reports261, request3162, and353 non-monitoring server operation records. Capture these records before/after; rely on the preserved updater's pending-operation guard for local unsent scans, and do not claim a physical offline queue inspection without device evidence.

Final candidate264 includes the ordinary263 features and correct monitoring version. Version264 avoids reusing263 after the guarded publication briefly exposed its feed before rollback. PR1032 also verifies the real API health route before changing files.

## Published and physically verified

PR1028,1030,1032 merged into feature/la_panthera. Final package is pro.logoff.wms.tsd.servers version264, SHA256 ddb7aeb5c963a5797e729682be65751e38e878499142f622fdc7dc5d60f10e75. Public versioned APK and compatible alias hashes passed; main263 channel, all container IDs/images and API health unchanged. The ordinary APK is not replaced.

One UPDATE_APP command was issued through the existing administration service only to the authorized owner terminal. Heartbeat then reported0.1.264-packing-modes with the same account. Request3162 remains IN_WORK with identical composition; all934 pre-update assembly-unit IDs and375 non-monitoring operation IDs remain, with377 operations afterward. The user reopened3162 and confirmed previous progress/cartons and continued operation. No reinstall, data clear, session reset, inventory unlock or scan replay was performed.

Validation:706 Android tests,12 release guard tests, exact normalized comparison of every baseline DEX class and resources, signed package/version/certificate checks, CI green. The initial two guarded publication attempts rolled back; final264 avoids reusing the briefly visible263 feed. Source/runtime parity remains false; build from the documented published APK baselines, not an unverified whole-source APK.
