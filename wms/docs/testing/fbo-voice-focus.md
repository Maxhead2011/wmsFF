# FBO scanner focus and user recordings

Branch: `fix/fbo-barcode-kiz-focus`; proposed PR base: `feature/fbo-packing-mode-choice`.

- Web: successful marked-product barcode returns focus from the submit button to the same input, now awaiting KIZ. Invalid barcode does not advance.
- Android logoff: user recordings replace box, barcode and KIZ prompts. PUT retains original recording and appends the new barcode recording.
- CLOSE_BOX confirmation speaks once, only after successful server response; redraw does not interrupt CLOSED with BOX.
- No server, stock, billing or schema changes. Other Android flavors do not enable this packing voice flow.

Browser regression: from apps/web, with Playwright available on NODE_PATH, run `node scripts/test-fbo-focus.cjs`. `FBO_TEST_BEFORE=1` removes the focus fix in the temporary browser bundle and reproduces the failing focus assertion.

Release note: do not deploy this checkout wholesale. Production release 195 includes separately preserved fast receipts, checkpoints and pick closure. Apply this small UI patch to the current production source overlay, preserve those features and test the actual release before publication. Production CLOSE_BOX uses the ordinary acknowledged response path; fast receipt handling for item scans must remain unchanged.

Local validation: browser regression fails without focus fix, passes with fix; web 206 passed; TypeScript noEmit passed; Android 870 executions, 0 failures, 0 errors across six variants; API 2699 passed, 38 skipped.
