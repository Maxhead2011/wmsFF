# Published PR759 — Ozon all-client request rows

Captured 2026-10-29 after publication, public asset verification and API health.
The preceding baseline is `2026-10-29-fbo-compact-focus` (PR755).

- API: `sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be`
- Web: `sha256:3525263c62e19dc4bfd069ae098d5a3d93537e9cabfd45ef15c13e3f30936994`
- Exact change: 2 API list/controller files; web index + Ozon host + scoped CSS.
- 684 API runtime files captured; schema, APK242 and other containers unchanged.
- `sourceParityVerified=false`: do not replace production with a full source build.

Validated: API3975/web542 (150/2 skipped), TypeScript/build, baseline8,
runtime34, isolated PostgreSQL9/full API health and candidate/public browser23 each.
Public read-only transaction returned all 10 active and 35 completed Ozon requests
for the checked branch, across 3 clients, with client/composition metadata.
Empty customer scope returned none; anonymous endpoint returned401.

`manifest.json` includes exact artifacts, image identities and release proofs.
`public-verification.json` contains the public browser and read-only query checks.
No credentials, environment dump or business records are included.

Rollback tags: `logoff-api:before-ozon-all-clients-20261029` and
`logoff-web:before-ozon-all-clients-20261029`. Sold WMS was not changed.
