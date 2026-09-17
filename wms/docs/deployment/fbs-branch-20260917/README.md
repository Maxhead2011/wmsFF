# FBS branch display deployment overlay

The production API and web contain the previously deployed snapshot/background FBS reader, which is absent from the integration branch. `production.patch` is the exact narrow source delta for this release; it preserves that reader and its parameter positions. It is an alternative to the integration-branch source diff, not an additional patch to apply after it.

Baseline API: `0191cd27dda7365abef4179f068e6e634a1e46e65106ff9faf21db3fb54843ff`.
Baseline web: `fad6856e58221baea0715c1074ca9872f895976075f031f1976e89f30ade71a8`.
Web source builder: `logoff-request-author:web-build`; rebuilt baseline assets matched production byte for byte.

Apply only after verifying those images and `git apply --check` against their extracted source. Build API and web, run both branch regression suites and `snapshot-check.cjs` against the compiled candidate, then run a read-only database check of warehouse routing and client links. Preserve all existing downloadable files and assets. No schema migration.

Enable `WMS_FBS_SELECTED_BRANCH_FILTER=true` only on our deployment and pass it through the API compose environment. Default-off behavior is tested for the sold WMS. Keep pre-release image/config backups for rollback. The snapshot check does not connect to a database or marketplace.
