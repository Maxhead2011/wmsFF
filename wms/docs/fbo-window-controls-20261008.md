FBO operational windows did not register with the la_panthera minimized-window dock. Read-only polling and persisted uncertain operations also disabled Close and Refresh, trapping the user during slow responses.

Use the standard window header; distinguish a read from a write so closing remains possible during refresh. Allow a read with a persisted uncertain operation without clearing or replaying it. Keep controls locked while a write is in flight.

Validation: 395 web tests passed, 2 existing browser-only skips; TypeScript passed. Browser regression fails on the deployed baseline and passes on the candidate, including delayed reads, persisted operation identity, active-write protection, minimize/restore/close. Existing multi-window browser suite and five lazy-section navigation checks passed.

Our WMS only. Source/runtime parity remains false: patch the exact deployed FBO function and remap the existing single-React asset graph for cache invalidation. API, DB, APK, flags and sold WMS unchanged. Runtime hash allowlist verified against a fresh snapshot. Rollback: logoff-web:before-fbo-window-controls-20261008.

Integration: feature/wb-print-check. Candidate staging directory: /opt/logoff-wms/wms/work/fbo-window-controls-20261008.
