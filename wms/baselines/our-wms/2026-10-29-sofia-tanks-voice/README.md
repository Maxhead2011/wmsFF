# Published PR763 — Sofia's LOGOFF TSD voice pack

Captured 2026-10-29 after publication and independent public verification.
Previous baseline: `2026-10-29-fbo-modal-rows` (PR761).

- LOGOFF APK243, `0.1.243-sofia-tanks-voice`: 13 approved offline recordings for 17 existing events.
- API: `sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be`, unchanged.
- Web: `sha256:4f4ac23ce16bdb0aab407ca9b900af9899399a74aa6ddc5c254ec37ece6b207d`.
- Exact three-file change: versioned APK243, latest-APK alias, update metadata.
- All other 3188 web files, all 684 API files, schema, other containers and sold WMS retained.
- `sourceParityVerified=false`: this release does not authorize replacing the live application with a full source build.

Validation: 858 Android tests (286 per flavor, no failures/skips), release/lintVital,
eight baseline guard tests, signed payload/certificate, all 25 existing raw assets,
public hashes/version and health passed. Six new tests include the failing-before
account-ID regression, all 17 routes, session closure and sold-flavor isolation.
Physical listening on Sofia's terminal remains unverified; APK installation required.

`manifest.json` contains image identities, verified compiled API/schema hashes and
the release receipt. No credentials, environment dump or business records included.

APK SHA-256: `de646513ae9686f2b8b6c86c00f43abdc8731b70576dc6c74947dd9506f613bc`.
Rollback: `logoff-web:before-sofia-tanks-voice-20261029`.
