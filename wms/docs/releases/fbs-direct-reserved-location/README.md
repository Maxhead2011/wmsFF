# Direct reserved box route in FBS online execution

Order 5864079913 in request 1368 has a RESERVED task for FFL_LKB0909_356,
PALET_SORT_140. The existing live-location fallback only covers relabel sources.
An ordinary reservation missing from instruction allocations therefore has no hint.

The new fallback adds only direct RESERVED/IN_PROGRESS tasks belonging to an active
request link and the same request item/SKU. Physical evidence excludes the fallback.
Existing allocations are not duplicated. The existing balance lookup enforces the
request owner/warehouse, AVAILABLE positive quantity and active box status.
No stock, reservation, order or request mutations occur.

Shared module: TsdAssemblyService.loadFbsAssemblyFacts. The existing
WMS_FBS_ONLINE_RELABEL_LOCATIONS_ENABLED flag isolates our installation; off behavior
is retained for the sold WMS. Do not deploy this baseline to sold WMS.

Validation: regression fails before and passes after; API 2801 passed, 94 skipped;
DB-dependent kiz-duplicate.integration excluded without a test database. TypeScript
passed. Four actual candidate runtime tests passed (direct, flag off, exhausted,
relabel). Read-only replay using live request/task/balance data and an empty
instruction allocation returned no box before, one reserved unit at PALET_SORT_140
after. This replay models the missing instruction; it is not a browser verification.

Release base: verified live PR317 image
sha256:45d6c29e16eb49035603749f58ef0272fa3e414eea269a5ee3f0a7f9bbe4acf4.
Materialize 2026-09-25-fbs-box-scan, run build.cjs with the target directory,
then release_baseline.py check-candidate allowing only modules/tsd/tsd-assembly.service.js.
The builder inserts the fallback without replacing deployed relabel/Ozon logic.
Source parity is still false. No full source build deployment. Published PR319 on 25 September 2026 at 23:33 MSK. Post-release read-only verification with the actual instruction and live balances returns the correct box and pallet for request 1368. Browser interaction remains unverified.

Proposed PR: fix/fbs-direct-reserved-location → feature/wb-print-check.
