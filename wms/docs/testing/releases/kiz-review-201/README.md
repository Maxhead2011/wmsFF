# KIZ review release 201

Automatic task-scoped review cases, ADMIN/OWNER decisions in WMS and TSD, and audited single-unit replacement without a complete box recount.
API WMS_KIZ_REVIEW_QUEUE_ENABLED and web VITE_KIZ_REVIEW_QUEUE_ENABLED are enabled only for our WMS; sold flavors keep their existing behavior.
Migration creates KizReviewCase and three indexes; existing stock and KIZ data are unchanged. Backfill only creates pending cases, never approves reuse.

The user approved retaining the published SKU checks and adding the per-unit approval and decision consumption, plus merging the API registry.
The exact production overlay is in published-source.patch; the repository retains its other already-merged features.

Validation: local API 2739 passed / 60 skipped and web 209 passed before release; exact production-overlay transaction test and four unit tests passed.
The installed API image includes an older test suite: baseline and candidate both have the same 155 failing tests, with no newly failing test; comparison is recorded.
Exact server API typecheck and new unit tests passed. Exact web candidate 173 tests and typecheck/build passed.
Exact Android candidate 1134 tests across six variants passed; APK contents and preserved prior source verified.
Signed upgrade 200 to 201 preserves language, settings and pending operations.
