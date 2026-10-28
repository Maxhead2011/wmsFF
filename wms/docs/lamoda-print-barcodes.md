# Lamoda barcode lookup in printing

Prepared on `fix/lamoda-print-barcodes`; **not published**.

Read-only inspection of Lukin CL-000001 found 136 confirmed active Lamoda cards.
All 136 Lamoda barcodes already existed as warehouse barcode aliases. Printing
neither labeled those aliases as Lamoda nor searched Lamoda externalSku/remoteSku.
No barcode, stock, reservation, receipt or mapping records were changed.

## Changes and isolation

- `SkusController.list` passes an explicit `forPrint=true` query argument.
- `SkusService.list` adds client-scoped confirmed/present/active Lamoda identity
  search only for printing while `WMS_LAMODA_ENABLED=true`. Other SKU callers keep
  their old contract and warehouse barcode list.
- `print/lamoda-print-barcodes.ts` labels existing aliases without duplication and
  projects a missing linked barcode as a non-primary print option. Exact strings,
  including leading zeros, are preserved. No Barcode records are inserted.
- `SkuLabelForm` and `fetchSkus` opt in and show the Lamoda source; primary barcode
  stays selected until the operator explicitly chooses another option.
- Runtime `PrintAgentService.createSkuJob` rechecks the active confirmed Lamoda
  link against the already permission-scoped SKU/client when the barcode is not
  a warehouse alias. Invalid/stale/foreign links do not enqueue anything.

Sold WMS is not deployed to or reconfigured; its disabled Lamoda flag retains
the old behavior. Existing printer station, layout, quantity and PNG validation,
WB/Ozon printing, queues, stock and KIZ accounting are preserved.

## Runtime parity

Production has a newer bulk SKU printing component and PrintAgentService absent
from this branch's source tree. Do not overwrite them with the stale local build.
`scripts/releases/lamoda-print-20261028/prepare.cjs` and `patch.py` apply unique
compiler hunks plus one reviewed agent condition to a materialized baseline.
`web.py` changes only the deployed `rF` printing function: two lookup parameters
and Lamoda labels for dropdown/single-barcode display. It fails on changed anchors.
The production import map currently redirects the host to `workspace-main-20261028.js`;
patch the actual current host after verifying the live release, not an unused copy.
Publication requires a fresh image/hash check and a PR into `feature/wb-print-check`.

## Evidence

- API regression reproduced the missing print alias before the fix; seven tests
  cover projection, existing-alias annotation, no duplicates, client isolation,
  controller opt-in and disabled-module behavior.
- Web request regression retains exact barcode text and opt-in isolation.
- Candidate runtime: eight checks through the actual SKU controller and print
  agent, including rejection after revoked mapping, foreign SKU and disabled flag.
- Candidate browser: three scenarios on the deployed shell, synthetic API only:
  Lamoda lookup/explicit choice, exact barcode in PNG print job, client reset.
  The same browser scenario fails before the fix because no result is found by
  the Lamoda article. No physical print was issued.
- Proposed handler tested against production in a READ ONLY transaction: six
  successful lookups by Lamoda remoteSku, externalSku and barcode for two cards.
- Full API: 3894 passed,155 skipped; dedicated unconfigured
  `kiz-duplicate.integration.spec.ts` excluded. Web:537 passed,2 skipped.
  API TypeScript with isolated current Prisma types and web TypeScript/build
  passed (existing bundle-size warning). Baseline guard verifies exactly four API
  changes against API image `sha256:48ccf6622d2aad597c8784f8033a0644d5504ac3971d1f614e7449349c0f8140`.

Local evidence: `D:/WMSFF/_Kof/work/lamoda-print-20261028`.

Candidate is based on live PR737 (API PR735, APK237). Isolated PostgreSQL: six passed and full Nest API startup verified. PR737 stylesheet entry is preserved.
