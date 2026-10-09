# Published: KIZ review after inventory confirmation

Published 4 October 2026 as PR479 (open at release), source commit e1bc27a10282e39dbd2b3cf2296144483300fa67.

- API: sha256:eae88e3014252c672e4d0564ae08580dd1e86ebe314dee6a4a004cae64cc7f45.
- Web unchanged: sha256:1a5e6d8847002aae15640e22052cc6c1682ff9f4c7c6e742d5438f4b7dac53d1.
- Exact one-file overlay, 569 API runtime files verified; existing billing/FBO behavior retained.
- New administrator inventory-reuse flag enabled only on our WMS.
- 40 new and 23 existing runtime tests passed. Full local suite retains identical 45 old failures and two missing-file suites, explicitly accepted by the owner for this release.
- Public health and task-specific replay with fresh WB evidence passed. Replay intercepted all writes; administrator still must explicitly approve the review in the UI. Physical TSD scan was not performed by this release.
- Stock, KIZ registrations and immutable shipment history not changed by deployment. Web/APK/print-agent/other containers and existing environment preserved.
- Rollback image: logoff-api:before-kiz-inventory-review-20261004.
- Verified archive: /opt/logoff-wms-releases/kiz-inventory-review-20261004/published-api.tgz; local D:/wmsff/vps-backups/verified-runtime-kiz-inventory-review-20261004/api.tgz.
- Archive SHA256: 382279e2358a3f5fc2e7066bc2dc5e835d9c100a2feb7a46721bda1964c4142e. This is not a database backup. Source/runtime parity remains false.
