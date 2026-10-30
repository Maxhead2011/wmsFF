# Single web entry after Ozon label history update

PR786 updated the import map to the new core module but left the HTML module
script pointing at the previous core. Import maps do not rewrite script src.
Both modules executed createRoot against the same DOM, causing removeChild
errors and a blank screen. The isolated component fixture did not exercise
the actual HTML entry and therefore missed this regression.

FIX: update the HTML script src alongside the core import-map target in
`scripts/releases/ozon-label-control-20261030/prepare.cjs`. The runtime repair
changes only index.html; all other 3204 web files, API, APK248, schema, data,
prior Ozon functionality and sold WMS remain unchanged.

TEST: `scripts/releases/ozon-single-web-entry-20261030/browser.cjs` opens the
actual application entry in three fresh browser contexts, then reloads each.
It asserts login availability, no uncaught page errors and one core module.
The published PR786 entry fails; the candidate passes all six cases.

The deployment script checks the fresh base images under release locks,
compares every web file, requires a merged PR and browser proof, keeps a
rollback image and verifies public HTML, health and unchanged other containers.
