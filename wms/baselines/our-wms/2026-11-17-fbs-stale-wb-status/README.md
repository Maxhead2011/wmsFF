# API baseline after PR1020

Captured from the running own-WMS API after publication on 2026-11-17.
785 runtime files. `sourceParityVerified=false`.

Only the marketplace service display-refresh callback and the new WB display
reconciliation helper changed. Environment and other containers were verified
unchanged. The manifest retains the historical `infra-api-1` key consumed by
`release_baseline.py`; the captured runtime belongs to our current API service.

Seven isolated candidate/runtime tests passed. Actual FBS snapshot and archive
HTTP reads confirmed all eight screenshot orders outside active/New, with
`complete / sorted` matching fresh official WB responses at 15:20 Moscow time.
This snapshot contains API runtime. Web was outside the release delta.
