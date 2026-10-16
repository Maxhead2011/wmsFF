# Ozon label creation: explicit throttling

Prepared 16 October 2026. `OzonAssemblySupplyService.call` already retried explicit HTTP 429 for reads and cargo creation. Label creation (`/v1/cargoes-label/create`) was excluded, immediately becoming WMS HTTP 502. The same bounded retry now includes label creation: up to three attempts, increasing pauses, Retry-After respected up to the existing 10-second per-pause bound. Longer cooldowns return an error without an early retry. Network errors and HTTP 5xx are not retried.

Source regression failed before the fix. Runtime tests cover success after 429, ambiguous transport failure, HTTP 500 and long Retry-After. Exact one-module overlay; no cargo or stock records changed. Historical six 502 responses on 16 October have no retained upstream response in timing logs, so attributing all six to throttling remains unproven.

FBS scan and completion investigation is separate. Read-only probes found receipt exclusion calls 14–141 ms, sticker history 41–58 ms, daily counts 3–4 ms. These probes do not explain historical 10–14 second requests and are not full-shift statistics.

Verification: API 3509 passed / 155 skipped, web 445 passed / 2 skipped, TypeScript passed. Dedicated KIZ DB suite excluded as unconfigured. Initial parallel API run had one unrelated PDF timeout; full constrained rerun passed. Actual base ee47f20 differs from recorded PR629 in receipt-channels.controller only; the live client receipt visibility correction is preserved byte-for-byte. Candidate changes exactly one Ozon module; four actual-image cases passed.
