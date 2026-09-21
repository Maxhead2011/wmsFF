# FBO reservation and shipment history correction

Branch: fix/fbo-picked-stock-reserve. Proposed PR base: feature/wb-print-check.

## Behavior
- Net AVAILABLE movements of type MOVE now release ordinary request demand, alongside PICK/PACK/SHIP/RETURN. Transfers within AVAILABLE cancel out; FBS sticker picks remain excluded from this request-level deduction.
- With WMS_WB_ORDER_STOCK_LIFECYCLE_ENABLED, the WMS stock snapshot uses the same remaining demand as WB. Moving picked stock from PACKING to SHIPPING cannot recreate a reservation.
- With WMS_FBO_TWO_STAGE_ENABLED, confirmed shipment archives packed FBO KIZ using stable fbo:<unitId> identities. Merely completing packing does not archive shipment. History rebuild does not alter marks; shipment detaches only matching SHIPPING marks from their exact target box.
- Existing disabled-flag installation behavior is unchanged.

## Production read-only evidence, 2026-09-21
- Across all active outbound requests, only 1029 had net MOVE picks causing this reserve mismatch: 1708 units.
- Candidate calculation against current production data: 1029 reserve 7 (previously 1715); 1220 reserve 3088; 1221 reserve 2108.
- No DONE requests using the two-stage FBO assembly model were found. No historical FBO shipment was fabricated or request forcibly closed.
- No production inventory, request status, WB stock, or billing changes performed during this investigation.

## Tests
- Before fix: 4 reservation/snapshot regression tests failed; shipment archive regression failed.
- Focused tests pass after fix, including return, internal transfer, DONE, disabled rollout, and history replay guards.
- Full API run initially had 2698 passing tests and 112 skipped; one pre-existing integration-suite collection error due to an undefined PostgreSQL URL, reproduced unchanged on base commit 544f8fc4.
- Final non-integration API suite and TypeScript check recorded in work/fbo-reserve-final-tests.log and work/fbo-reserve-final-types.log in the parent workspace.

No publication has been performed. PR requires user confirmation.

Final result: 234 non-integration test files passed; 2702 tests passed, 22 skipped. TypeScript noEmit check and API build passed.
