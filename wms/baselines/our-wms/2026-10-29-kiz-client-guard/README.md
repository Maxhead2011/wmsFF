# Published PR765 — client KIZ duplicate guard

Captured from the live containers on 2026-10-29 after publication. Previous baseline: `2026-10-29-sofia-tanks-voice`.

- API `sha256:56c804ffc2dab2ac817a2cd452f62840a16927ef0fdf21070d881a38ddafbdad`.
- Web `sha256:7362d9a62e27c993452abb6c2a3caa8963ff3e2de0f828a34b7dfc5a8cee5b60`.
- LOGOFF244, SHA256 `bb45142cf15f30e8eddaa991751636eedcca77e4e8b540934efc5b2e69fafdd4`; all 13 Sofia voice assets retained.
- Exact18 API module changes; three isolated web functions plus APK downloads; remaining deployed runtime preserved. 687 API files captured.
- One additive `KizClientRegistry` and five concurrent indexes. Backfill writes registry only. Post-release read-only verification: 89,320 proven receipt origins, 15,660 unknown origins; stock records were not repaired.
- `WMS_KIZ_CLIENT_GUARD_ENABLED=true` only in our API image. Sold WMS unchanged. `sourceParityVerified=false`; do not replace production using a full source build.

Checks: API4018/web555 passed (155/2 skipped); Android885, TypeScript, source browser10/runtime16/preserved7, PostgreSQL12, actual API runtime26/full Nest health, baseline8. Public health/hash/APK and four live read-only client/provenance checks passed. Legacy dedicated KIZ-print integration requires its own unconfigured database; the new isolated PostgreSQL tests were mandatory and ran.

Rollback: `logoff-api:before-kiz-client-guard-20261029` and `logoff-web:before-kiz-client-guard-20261029`. Keep additive registry/indexes on rollback. Physical terminals must install244 to show the red stop screen; old clients receive the server rejection.

Manifest contains compiled modules, schema, publication receipt and exact hashes. No credentials or environment dump are included.
