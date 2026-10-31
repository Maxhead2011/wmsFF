# FBO shipment KIZ prefix lookup

Request 2565 (1710 packed units, 159 confirmed boxes) hit the existing 60-second
TSD and 120-second recovery transaction deadlines on 2026-10-31. Server stack
traces terminate in loadShipmentKizReads / productMark.findMany. A read-only
probe of all shipment identities took 47.940s on the legacy path and 4.438s
on the indexed path; six evidence collections matched by identity and row ID
(SHA256 d5f5bbba5bd26cad8e7d7c7dda278728357a9eac53376797877a3252244b479a).
These timings exclude full completion, file generation, camera and network.

The existing 21 historical scanner spellings generate hundreds of OR/LIKE
terms in each batch of 20 keys. The own-image WMS_KIZ_SHIPMENT_PREFIX_ENABLED
flag replaces only the five prefix lookups with parameterized LATERAL indexed
text_pattern_ops ranges. Hydration, exact client/status scope, review cases,
identity locks, transaction rollback, duplicate/history decisions and claims
remain unchanged. Saturation fails closed. The flag defaults off for sold WMS.
No stock or business records are repaired by deployment.

Changed runtime: common/kiz-shipment-reads.js and common/kiz-shipment-prefix.js.
Source: same-named TypeScript files. Tests: kiz-shipment-prefix.spec.ts,
kiz-shipment-batch.spec.ts, kiz-shipment-gates.spec.ts; disposable PostgreSQL
tests in scripts/releases/fbo-shipment-prefix-20261031 test full completion,
retry, locks, review/duplicate/history rejection and literal scanner forms.

The verified live predecessor is API
sha256:884a0905f5562e9ae5d9b10512d5b2ec75cee3234f4282de383d0544f659afa3,
web sha256:b627fd1e020e6d1985ef5a8f5d1142d25fd7063a81afce333b7a814a79554ee0.
It is newer than the PR800 recorded baseline: ten API deltas concern billing
and marketplace-connections. All are retained through an exact image overlay;
the shipment reader itself matches the recorded predecessor byte-for-byte.
Source parity remains false. Do not deploy a full local dist.

Validation: API4206/web582 passed (151/2 skipped); API TypeScript, baseline8,
24 focused tests, full synthetic1710-unit/159-box completion and retry passed.
The synthetic full finish took16.1s. No production FINISH was executed.

Prepared, not yet published. PR target: feature/wb-print-check.
