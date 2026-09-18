# FBO packing release 192

PR #215 targets feature/fbo-fbs-location-voice. The production source is ahead of that branch. published-source.patch records the exact narrow overlay onto the currently published sources; it preserves later fast acknowledgements, checkpoint recovery, parallel packing, scanner focus, voice, FBS and inventory changes.

Only LOGOFF switches packing modes. A restored open target box automatically resumes new-box packing. The checkpoint test fails without that recovery and passes with it. The final control guard still requires the persisted PACKING phase.

Base API and final image hashes are in images.json. Base web: sha256:164ad5dbe94df009b1b6cd4bdb5dc677d7dab95f2c9710df5182e00ad72314a2. Exact matching web builder: sha256:e182ea193aaf28aaf083824efd5a0d51fbfcd11594c6c9c0f20d2643c5d2ca78. Android source baseline: fbo-parallel-20260918, version 191.

Validation: local API 2647 passed, 74 skipped; separate local PostgreSQL FBO integration 28 passed; local web 206 passed; current production web builder 151 passed; both TypeScript builds passed. Android candidate test counts and signed upgrade 191 → 192 are in the JSON evidence.

The full API image test suite has pre-existing failures because its tests lag published overlays. Both images were tested without network or production database access; candidate-tests.json records the comparison. No additional failures are allowed. This limitation is not reported as an entirely green production image suite.

No database migrations, production data corrections or WB API uploads. Existing downloads are retained. Publication requires unchanged baseline images and metadata; rollback images and configuration backup are retained on the server.
