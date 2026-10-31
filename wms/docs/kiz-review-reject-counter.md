# KIZ review rejection and attention badge

Prepared in fix/kiz-review-reject-counter; not published.

The production controller validator accepts REUSE/RELABEL while the client and the guarded service also support REJECT. A shared DTO now validates REJECT, preserving required confirmation/reason and existing scoped service decisions. The existing production queue routes are represented in source; the runtime-only queue module must remain in the overlay (source parity is false).

KizIssuesService.list wraps the legacy report, including its no-request early return. An optional attention total adds OPEN review cases in the selected warehouse/client scope to legacy unread issues. UNIT/FOUND entries are separate workflows and are excluded. Approved/rejected/resolved cases are excluded; inactive legacy task contexts are excluded. Merely reading an OPEN review does not clear it. Existing WMS_KIZ_REVIEW_QUEUE_ENABLED and administrator roles gate reads; sold behavior remains unchanged when disabled. The web falls back to the old unread count on older servers and refreshes after a successful decision only.

Tests: kiz-review-attention.spec.ts reproduces HTTP validation failure and missing receipt-review count, tests disabled feature/access, empty FBS report, and inactive cases. Existing kiz-client-review.spec.ts validates scoped audited rejection. No business records changed.

Separate finding 31 October: Kubrin barcode 4630584395559 was created at 13:04 UTC with needsChestnyZnak=false and no stock movements. This is a new-card default problem, not evidence of a physically duplicated dress. Do not link it automatically to the photographed review with a different KIZ identity.

Deployment must use a fresh production baseline. Observed API 6dbdb519fba13e6fe10d6b1d45c198c96d348cb10696474a3b05ab8d102436ef and web b627fd1e020e6d1985ef5a8f5d1142d25fd7063a81afce333b7a814a79554ee0; these are newer than the prior locally documented PR800 baseline. No deployment performed.

Validation: API full suite 4202 passed / 156 skipped, one existing billing-PDF test timed out under full parallel load; isolated rerun of all billing-PDF tests, API registry and five new regressions passed (53). Web 582 passed / 2 skipped. API and web TypeScript checks passed. Dedicated KIZ DB integration excluded without an isolated database. No production publication or stock mutation.
