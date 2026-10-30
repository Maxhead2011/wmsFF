# Published atomic FBO camera captions

PR769 merged as `93211822278cb13883665fd67b34ce9f291e2446`; deployed on our WMS at 2026-10-29 18:54 UTC. API image `sha256:e96334e56c8416fb770b6eee459a46c15ace932d672c29a12e03410404664db4` has 688 verified runtime files. The FBO service changed and one helper was added; the other 686 files remain identical to previous API image `sha256:5c9b375d8ccbad42664bfe34dbfd909bbb5f35c6a367ce9b797265c0f664ce70`.

`WMS_CONTOUR_FBO_CAPTIONS_ENABLED=true` is enabled only on our WMS. All previous 188 environment entries and other container identities were preserved. The web image and LOGOFF TSD245 are unchanged. No production packing event or business-data repair was manufactured.

`AuditLog_contour_createdAt_id_idx` was created concurrently and is valid/ready. The actual exporter filter uses an index scan: 0.128 ms, 7 shared buffers at verification. See `index-exporter-proof.txt`. Health is ok and restart count was zero. No new real FBO packing occurred during the recorded observation window; future live caption verification must use naturally occurring scans.

API4039/web555, both TypeScript checks, baseline8 and actual-container runtime10 passed; optional integration skips are recorded in the feature document. `sourceParityVerified=false`: use this complete captured runtime for later overlays, never rebuild the whole legacy TypeScript service over production.

Rollback disables the caption flag and bridge audit polling and restores the previous API image (`logoff-api:before-contour-caption-20261029`). Retain the additive index and historical snapshots. Server release proof and private configuration backup are under `/opt/logoff-wms/wms/work/contour-caption-20261029-4c991122`; no secret configuration is included here.
