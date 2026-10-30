# Published PR761 - Ozon and Lamoda FBO operational dialogs

Captured 2026-10-29 after publication, public asset hashes and API health.
Previous baseline: `2026-10-29-ozon-all-clients` (PR759).

- API: `sha256:b99d8dafcf402fbdf04f4baca725a0a680b7ddd8a555126e324dd5263d56b4be` (unchanged).
- Web: `sha256:7899d4c73164746a590a622f038f3109a3292200d1326f5fbdec995542f35473`.
- Exact change: index, two marketplace hosts, core modal-header handling and scoped CSS.
- All 684 API runtime files, schema, APK242 and other containers unchanged.
- `sourceParityVerified=false`: do not replace production with a full source build.

Validation: API3975/web548 (150/2 skipped), TypeScript/build, baseline8,
candidate/public browser32 each, module graph8, offline capture5. Regression RED/GREEN
includes loading followed by minimization and retained state on response.
Dedicated KIZ DB integration suites excluded; browser operations use synthetic fixtures.

`manifest.json` records image identities, artifact hashes and publication proofs.
No credentials, environment dump or business records are included.

Rollback: `logoff-web:before-fbo-modal-rows-20261029`. Sold WMS unchanged.
