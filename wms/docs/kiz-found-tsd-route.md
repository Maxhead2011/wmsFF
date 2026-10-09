# LOGOFF223: found-KIZ request route

The Retrofit base URL is the site root. `WmsApi.foundKizAction` must use
`api/v1/inventory/kiz-found`; the unprefixed path in222 did not reach the API.
`KizFoundRouteTest` builds actual Retrofit requests for OPEN, REUSE, RELABEL,
RETURN and REJECT. It failed on222 and passes with the corrected route.

Only LOGOFF APK/download metadata is published. API, stock, configuration and
FFULHAB deployment are unchanged. The existing LOGOFF-only UI gate is retained.
The staged overlay compares every web file and permits exactly the versioned
APK, default LOGOFF APK and LOGOFF metadata. Signer certificate and APK contents
are verified. Deployment uses release locks, checks the current image and merged
PR, verifies public hashes and health, and rolls back on failure.

Validation: Android243 per LOGOFF/FFULHAB tested variant; API3265 passed/144 skipped;
web412 passed/2 skipped. Dedicated unconfigured KIZ integration suite excluded.
LOGOFF release build/lint and aapt version223 verified. Physical scanner check is
pending installation of223; no production review case is created by deployment.
