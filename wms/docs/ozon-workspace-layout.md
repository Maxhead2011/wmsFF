Published PR599 / 2026-10-14: Ozon online execution embedded below the link-import form in the left column; right assembly list stays usable. Optional embedded mode preserves other modal callers. Web434/API3437 passed;2/150 skipped, dedicated KIZ DB suites excluded. TypeScript, source/candidate/live browser checks passed. Only workspace and panel display properties changed in current runtime; API, APK232, flags, operations and sold WMS unchanged. Baseline `2026-10-14-ozon-inline`, sourceParityVerified=false. [Evidence](releases/ozon-inline-20261014.json).

# Ozon customer workspace — published PR594

Approved preview implemented on `fix/ozon-workspace-layout` and published through
PR594 into `feature/wb-print-check`, preserving the newer PR592/593 release.

- Customer workspace: 65/35 columns, compact request cards, separate full-width
  action rows. Below 760px of available workspace width, stack the columns.
- File/link forms: full-width fields, grouped upload/template, readable account
  owner labels. The shared client and warehouse selection remains unchanged.
- Supply panel: grouped connection/order fields, mapped directions, composition
  status and explicit confirmation. Existing frozen/busy/difference/packing
  guards and cargo export readiness are retained.
- `ozon-workspace.css` scopes selectors to these components. Generic packing
  panel controls and seller workspace dimensions are not restyled.

No API, database, quantities, routing, APK or print-agent changes. Sold WMS is not
deployed; this visual change belongs only in the our-WMS integration branch.

## Validation

Two added regression tests fail before the layout hooks are introduced and pass
afterward. `scripts/tests/ozon-workspace-layout.cjs` runs real React/CSS with all
API traffic mocked: 1440/1024 desktop, 736/390/320 stacked widths, default and
la_panthera Dark/Light themes, no horizontal overflow, named account, warehouse
forwarding, completed list, confirmation reset and disabled partial cargo export.
No create/upload endpoint is called. Set `LAYOUT_SCREENSHOT` to save a screenshot.

Web: 433 passed, 2 skipped. API: 3437 passed, 150 skipped; dedicated
`kiz*.integration.spec.ts` DB suites excluded as in the baseline. Web TypeScript
passed. No Android/agent code changed, their suites were not rerun.

## Release boundary

Read-only server check on 2026-10-14:
- API `sha256:853c97dfaa475a33eedcb14c1d1c746dbbbb06602707f361983fef060e6b6838`
- Web `sha256:73dcea096d2298053d5cc5eef3c6bbf723974c0cfa4d4cc009f8076da5ac0e74`

Web is newer than the PR590 web baseline. Before publication, capture the current
web graph and preserve its subsequent changes. `sourceParityVerified=false`:
do not deploy the complete local build. Prepare and browser-test the precise
UI delta against that fresh graph, then repeat live image checks under the release
lock. Published from the verified web-only candidate; the subsequent live browser check passed.

## Release candidate

Prepared from the fresh PR592/593 web image (APK232 retained). Runtime patch
`scripts/ozon-workspace-layout-runtime.cjs` replaces two import entry points,
one customer workspace and one supply panel, with one scoped CSS file.
Single React owner preserved. `scripts/releases/ozon-layout-20261014/browser.cjs`
verifies the actual candidate graph with the published CSS; the earlier account
access browser suite passes at both entry points. Stage verifies an exact 34-file
web delta and unchanged image configuration. Eight release-baseline tests pass.

## Published result

Web `sha256:e6c0ddf66d825d7f3b92ede9246cd8c7afd71af9f4e4e76e0d2eb5411772614c`. API unchanged.
Rollback: `logoff-web:before-ozon-layout-20261014`. Public file hashes, API health, APK232
metadata, unchanged configuration and other container IDs verified. The live
asset graph passed the same mocked browser workflow; no business records changed.

## PR596 compact follow-up

Removed the 585px nested scroll cap: every assembly now participates in document
scrolling. Reduced only customer form/card gaps; matching native file-selector
and template buttons preserve keyboard and download behavior. Five-row browser
regression fails before and passes after, including the live CSS graph. Only
index.html and assets/ozon-workspace-compact-20261014.css changed at runtime.
