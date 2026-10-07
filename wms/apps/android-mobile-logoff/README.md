# LOGOFF Mobile — native Soul candidate

Isolated on 2026-10-04, by Konstantin's authorization, from
`C:/WMSFF2207/repository/wms/apps/android-mobile` (uncommitted 0.5.3 sources).
Only `app/src/main`, Gradle project files and ProGuard rules were copied.
No signing keys, caches, tenant-specific sources or credentials were copied.
The original project, other tenants, TSD and live server remain untouched.

Attached APK: package `pro.logoff.wms.mobile`, 0.5.3 (22), SHA-256
`186a50bd744701acd5d06ce7426aed88adf67a53214b98295b6d33763ff1a2ea`.
Certificate SHA-256 `ac814931a7de234a979a765073146c4f1be44ee12fc4edf06a280ce075d42f42`.
Source version matches; byte-for-byte APK reproduction is NOT established.

## Implemented in this candidate

- Native Soul home, seven navigation groups, group expansion, existing native routes.
- Warm light / dark Soul, readable group accents, serif system fallback.
  Cambria is not bundled: no licensed font asset was supplied.
- Server-calculated client settlements, date/client filters, debt/advance/draft/unbilled
  values, line details, verification queue and read-only closed-period history.
- Native invoice correction history: server amount/sign, invoice number, reason,
  author and date; 25 entries revealed per tap. The server returns up to 2000 latest
  corrections for the selected client/branch across ALL dates, clearly labelled.
  Date/client changes cancel stale responses; this screen cannot write corrections.
- Native OpenClaw status, paginated history, submission and explicit result check.
  Pending request IDs are persisted per user BEFORE submission. Uncertain commands
  are never automatically resubmitted, including after screen recreation.
- Existing 0.5.3 screens and actions retained in the copy. No WebView imports.

## Not yet complete / not a published release

Published 0.6.2: native financial actions from **Клиенты и расчёты →
Исправить счёт / закрыть период**. Server preview and explicit confirmation are
required for signed invoice adjustments, late-work draft issuance and period close.
Pending request body/operation identity is saved privately per user before sending;
uncertain outcomes block new documents and allow only explicit same-request replay.
Client/branch/permission changes invalidate the screen. Server remains authoritative.
This increment is included in release 0.6.2; device validation is pending.

Additional 0.6.2 increment: client details → **Редактировать** for
`clients:write` users. Native form edits 14 contact/requisite fields through a
fresh GET and allowlisted minimal PATCH. Other client settings are never sent.
Preflight checks edited fields for changes, but is not server-side compare-and-swap.
After an uncertain save, only rereading is offered; no automatic PATCH replay.
Creation, deletion and imports are still unported.

Release 0.6.3: nine typed client settings for kind,
receiving, stock visibility, storage/logistics billing and FBS/relabeling visibility.
Unknown/missing server settings are not defaulted or overwritten. Confirmation
shows old → new values. Numeric tariffs and role/company assignments are untouched.

Catalog details → **Редактировать** has a native 0.6.3 editor for eleven
description/weight/dimension fields. It checks `skus:write`, user/client/branch scope,
fresh SKU identity and edited fields before PATCH. Decimal commas are supported;
server-normalized empty/zero weight is acknowledged. No stock, barcode or KIZ edits.
The existing API has no atomic compare-and-swap, so concurrent writes after the
preflight remain possible. Unknown outcomes require rereading, not automatic retry.

This is NOT full parity with the current web WMS. Still requires an endpoint/action
inventory for waves, statistics, FBO/DBS, KIZ workflows, printing, monitoring,
configuration, and other current server modules. Legacy module lists are not proof
of full action coverage. Financial mutation workflows are published in 0.6.2,
but authenticated device workflows remain unverified.
Soul wallpaper/custom gradients and exact desktop navigation animation are not ported.

No production commands or financial mutations were executed during development.
No device/emulator connected at initial validation. Device layout, login, permission
matrix and real read-only endpoint tests remain mandatory before distribution.
The default debug certificate differs from the attached APK: DO NOT distribute the
debug APK as an in-place update. The original signing key was located outside this
project and its certificate verified against the attached APK. Release builds use
it through environment variables only; no key is copied or committed. Verify the
resulting release APK certificate before any distribution. Do not uninstall the
user's app to bypass signing incompatibility.

## Checks

`node --test soul-contract.test.cjs`

`gradle :app:testLogoffDebugUnitTest :app:assembleLogoffDebug :app:lintLogoffDebug`

Only `logoff` flavor exists in this isolated project. API calculation logic and
authorization remain on the server. No APK upload/publish is performed by these commands.
