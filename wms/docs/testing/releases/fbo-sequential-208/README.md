# FBO/FBS release 208 — compatibility evidence

Only our VM is targeted. Common modules: FBO planning, FBS marketplace routing, Android picking. Sold VM is not deployed; both feature flags default off.

The patches apply to API image 3deec4531b3f2bb71825b1860c100394fa56c7ce24836f16d52d914cfdb36bdf and archived Android 207. They preserve fast acknowledgement, parallel packing, durable FBS receipts, relabel routing, Telegram notifications and voice resources. Six source conflicts were resolved with explicit user approval.

// FIX: FBO route retains current box/pallet; FBS sequential barcode/KIZ picking confirms location once, uses live validation and restores counters.

// TEST: 77 focused server tests passed on isolated PostgreSQL with no production DB access; 206 Android tests passed for each of six variants. Signed APK upgrade 207→208 starts and retains Uzbek language, preferences and pending operations. Source/dist/schema manifest and image config verified. Full repository suite before merge: 2848 API passed, 65 skipped; web 219 passed. This is not a claim that the full historical live-image suite is green.

Test fixtures were adapted to existing live legacy-mode and fast-ack behavior. The relabel mock includes absent duplicate configuration; production duplicate behavior is retained unchanged. APK DEX inspection resolves the compiled refresh lambda rather than expecting the interface call directly in refresh.

The original API image reached Docker mount-layer limits. A filesystem-export/import flattened base preserved runtime image config; only listed API source/dist paths differ in final image, schema unchanged. No stock changes or migrations are included.

Publication requires merged PR 283, matching live image IDs, signed APK upgrade verification and health checks; physical scanner verification remains after installation.
