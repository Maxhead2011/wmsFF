# Request author visibility, 2026-09-17

The list placed both creation time and author inside a two-line clamped element.
The persisted name existed but the UI could truncate it after `Автор`.

## Minimal change

- `ClientRequestsTable`: separate unclamped author line, preserving the recorded person's name.
- `client-request-author`: add WMS label only when explicit `client_request.author_confirmed` audit evidence exists for an authorless request.
- `ClientRequestsService.list`: attach labels after existing scope filtering. No request or stock mutations.
- `ClientRequestSummary`: optional backwards-compatible `creationAuthorLabel`.
- Approved one-off script: only 1034 and 1048, deterministic audit IDs, transaction and row locks, no fake user; replay creates no extra record. Any existing recorded user stops the operation.

Unknown author is NOT automatically WMS. No schema migration. Sold WMS, TSD and finance are not part of the author release.

## Verification

- Regression: author stays outside `.client-request-list-meta`; failed before the layout fix, passes after.
- Human wins over WMS; unknown remains unknown; unrelated audit data does not grant a WMS label.
- Full local API: 2682 passed, 63 skipped (includes separately prepared billing fix).
- Full local web: 233 passed. API/web typecheck and API build pass.
- Real browser synthetic component at 375, 768 and 1440 pixels: author wraps, no clipping, WMS visible. No screenshot baseline: visual pixel comparison inconclusive, not claimed.
- Before production: repeat the two-request confirmation on an isolated restored database and verify replay.

Publication uses an overlay against verified live images, preserving unrelated production changes and TSD download files. The separately rehearsed finance candidate may be included only with explicit approval of its 222 new drafts / 10,170 RUB impact; Konstantin supplied that approval in this task.
