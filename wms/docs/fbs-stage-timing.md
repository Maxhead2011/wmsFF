# FBS stage timing

Published via PR633 on 16 October 2026. Existing all-response histograms remain unchanged. Named timings cover owned-task lookup, WB KIZ preflight, stock reservation after acceptance, response formatting, request-status reconciliation, Telegram notification, sticker retrieval, the whole KIZ scan and the whole completion. They preserve call order, return identity and rejection identity.

Stage totals are nested and may overlap. Do not add them or treat them as a full decomposition. Remaining scan time may include KIZ validation, WB submission and database work; a short preflight alone does not prove WB is fast. Completion includes transactional work plus response formatting and notification. These measurements identify which narrower path requires the next investigation.

No identifiers or KIZ values enter diagnostics. Existing bounded slow-response logging and opt-in middleware control emission; no new flag, polling or background requests. Only our runtime is deployed. No claim that the 10–14 second historical delays have been fixed.

Validation: API3512/web445, TypeScript, three actual-image checks and exact one-file overlay passed;155/2 skipped, dedicated KIZ DB suite excluded. Read-only WB preflight probe took288ms; this does not explain the historical 10–14second delay.
