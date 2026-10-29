# Lamoda FBO: actual shipment submission

Prepared 29.10.2026 from PR746 / published PR745 baseline. Publication follows a merged PR into feature/wb-print-check and fresh image guards.

## Workflow

FBO -> Lamoda -> open assembly -> Shipment Lamoda by actual assembly. Finish TSD packing and box control first. Enter shipment/UPD number, Lamoda warehouse, planned date and RUB unit prices including VAT. Preview shows matched seller SKU, EAN, actual packed quantities and marking codes. Download the official-layout XLSX or confirm and create through API. Do not use both paths for the same shipment. UPD via EDI and Gate Management appointment remain separate.

Only PACKED units from completed assemblies with closed/confirmed boxes are allowed. Every request item must match its actual quantity. Both marked and unmarked goods work; source storage mode does not change the payload. Confirmed Lamoda identities must still match frozen relabel labels. No stock movement is created by exporting/submitting.

Persist SENDING before external I/O. Account + external shipment number is unique across assemblies. SUCCEEDED replays without sending. UNKNOWN and interrupted SENDING forbid retry and reconcile by number/date/warehouse/EAN quantities. Only explicit API REJECTED can be reset with an audit record. Concurrent receipt refresh cannot overwrite a reset or another attempt. Responses and statuses are retained across page reloads. API timeout never triggers automatic resend.

## Scope / files

- lamoda-actual-shipment.ts: pure payload and XLSX builders.
- lamoda-submission.ts: scoped preview/send/reset/reconcile and durable operation journal.
- lamoda-client.ts: FBO_CREATE-only write flag; all unrelated external writes retain their existing gate.
- lamoda.service.ts/controller.ts/dto.ts: six scoped endpoints with client/warehouse/write guards.
- administration-internal-api.service.ts: Lamoda route count 14 -> 20 only.
- schema.prisma and migration 20261029120000_lamoda_submission: one nullable LamodaFboAssembly.submission JSONB column; raw SQL permits current generated client runtime.
- LamodaSubmissionPanel.tsx, LamodaPanel.tsx, api.ts: assembly form, preview, export, send confirmation, Russian remote statuses, rejection correction.

Feature flag WMS_LAMODA_FBO_SUBMISSION_ENABLED=true only in our candidate image. Sold WMS, generic external-write gate and APK239 unchanged. Source parity remains false: exact baseline overlay, not a full local server build.

## Verification

API full suite, web full suite, TypeScript API/web, regression baseline guards, pure payload/template tests, receipt state-machine tests, isolated PostgreSQL concurrency and full Nest boot, browser candidate/public fixtures. No real Lamoda shipment is created as a test. Live marketplace acceptance of the first operational shipment remains to be checked with its actual commercial data.

Official contract and workbook inspected on 29.10.2026. API price.amount is integer kopecks; Excel uses rubles. API documentNumber is a UUID, so an ordinary UPD number must not be substituted for that field. Workbook dates and EAN are strings. Export file has date row1, shipment number row2, blank document row3, headers row4, data row5 onwards; marked goods one row per unit.

Final pre-release checks: API3959 passed /150 skipped, web539 passed /2 skipped; TypeScript API/web passed, baseline guards8, exact7 API delta verified, isolated PostgreSQL9 plus exact additive migration and full Nest health, candidate browser6. Existing skipped suites remain skipped.
