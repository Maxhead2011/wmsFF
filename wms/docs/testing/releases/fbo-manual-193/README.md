# FBO manual packing, release 193

Authorized integration of PR219 with the exact published API and Android192 sources. Preserve fast acknowledgements, durable retry/checkpoint recovery, parallel packing, scanner focus, and every unrelated module. The reviewed production overlay is published-source.patch; binary voice assets are in PR219. No database migration.

Only our API enables WMS_FBO_MANUAL_PACKING_ENABLED=true via the derived image; other existing environment values remain unchanged. Only LOGOFF Android offers the new menu. The APK is signed with the existing certificate and upgraded over 192 without clearing device data.

Validation: 39 real local PostgreSQL FBO tests, including idempotent manual fast acknowledgement during parallel packing; 1050 Android executions (175 x 6); release DEX/content verification; upgrade192 to193 retains language/settings and queued operations. Build compilation succeeded.

Isolated current server-image suites: 1398 tests, 131 pre-existing failures in both baseline and candidate, no new failures. These results are not presented as an entirely green server-image suite. The repository API tests passed separately (2693 passed,38 skipped).

Only two API source/compiled modules differ. Web image only replaces current Android download/metadata and adds the immutable versioned APK; all other assets/downloads are retained. Publication verifies unchanged baseline images, stores rollback tags, and checks public health, APK hash and signing identity. No production stock correction or WB mutation is performed by release scripts.
