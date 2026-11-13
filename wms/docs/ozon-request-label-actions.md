# Ozon FBS labels in Requests

Ozon requests expose the existing supply-label download and printer selection inside Requests. The dedicated host preserves the selected page. Only transfer to WB retains the WB-supply condition. The handler selects the exact request and rejects partial/unsupported order selections; no stock, billing, delivery or print-job behavior changes.

Files: ClientRequestsTable.tsx (action menu), requestSupplyAction.ts (selection), FbsPanel.tsx and App.tsx (generic loader). Regression tests cover Ozon before picking, incomplete selection, unsupported marketplace and WB-only delivery. Existing shared UI code changes only through the own-WMS release; sold deployment untouched.

Runtime: additive five-file web overlay on the fresh published image. Source/runtime parity remains false. release.py asserts all file hashes, unchanged API/container/environment and merged PR before publication. Current API was independently captured and materialized; no API delta.

Verification: full web suite 644 passed, 2 skipped; TypeScript passed. Browser uses actual read-only request 2988 metadata, synthetic two-page PDF and a synthetic printer station. Download bytes, printer selection, staying in Requests and zero print jobs verified. This browser fixture does not prove actual Ozon label availability or physical printing.

Live request 2988: deployed label handler was invoked in a rollback transaction with marketplace mutation guard. Official Ozon sticker unavailable for posting 0105432972-1093-1 before assembly. Therefore real two-label PDF and live printer opening for this request remain blocked by that existing prerequisite. No delivery or printing initiated. Do not report a successful actual pair for this request.

Additional checks: API 4804 passed / 181 skipped; dedicated kiz-duplicate.integration.spec.ts could not initialize because its isolated database URL is absent (no API files changed). Compact controls24 and request-fold layout passed. Existing WB2918 replay retained date/PVZ/cargo selection and 18-page download, without transfer or print.
