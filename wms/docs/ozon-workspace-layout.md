# Ozon customer workspace — prepared layout, not deployed

Approved preview implemented on `fix/ozon-workspace-layout`, based on the
PR590/591 source context. Intended PR target: `feature/wb-print-check`.

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
lock. This document does not claim runtime publication or candidate parity.
