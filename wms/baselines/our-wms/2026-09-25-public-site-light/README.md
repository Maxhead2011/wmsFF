# Published public website — PR313, 25 September 2026

This is an incremental **web-only overlay**, not a complete API or database backup.
Archive SHA-256: `6a744da508a22c91d3bd47db705b66cff5ff5be11f8b8c845d77b98fd35cb604`.
Apply it over the verified `2026-09-25-fbs-display/web-runtime.tar.gz`:
`index.html` goes to the web root; all JS and CSS go to `assets/`.
`proof.json` inside the archive records all asset hashes and unchanged operational
prefix/suffix hashes. Preserve previous files and all images/fonts/downloads.
Images, fonts, APK214 and API container were not changed.

Production result is recorded in `published.json`; release code and safeguards:
`scripts/public-site-release.cjs`, `scripts/deploy-public-site.py`.
Server payload/proof/rollback records: `/opt/logoff-wms-releases/public-light-20260925`.
Prepared image verified against all 294 prior files except the intentionally
replaced index. Public mobile page and absence of JavaScript errors checked.
Before publication, 1440/768/390 px layouts, stage selection, navigation and
login entry were verified without using real credentials.

No claim of full source/runtime parity. New functional WMS releases must retain
this overlay rather than deploying the old external screen again.
