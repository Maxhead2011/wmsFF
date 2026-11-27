# Sequential Ozon supply corrections

When multiple directions belong to the same Ozon order, submitting the next edit before the accepted edit finishes can return ORDER_LOCKED. The resume handler now polls the accepted operation before claiming a successor for that order, under the existing request lock. Pending/unknown operations block successors. Explicit FAILED + ["ORDER_LOCKED"] without an operation ID can retry once per resume. Successful operations and ambiguous writes are never resubmitted. Terminal status cannot regress after concurrent polling.

WMS application still requires every direction SUCCESS, matching fresh remote composition, and unchanged local assembly basis. No stock or billing writes are added. Existing WMS_OZON_FBO_IMPORT_ENABLED gate and access checks apply; deploy only to own WMS, not sold WMS.

Validation: 54 adjustment tests; exact compiled runtime partial-success/retry/replay checks. Full suite initially has 4,992 passed / 203 skipped and an unrelated KIZ duplicate integration collection failure from missing dedicated test DB URL; separate run excludes only that environment-dependent file.

Runtime: source parity remains false. Capture current 815 API / 3382 web hashes. Preserve current turnover and FBO two-stage runtime drift relative to PR1099. Replace only the compiled resume prefix through the final fresh-composition check in ozon-stock-adjustment.service.js; all other bytes and modules retained. Base: baselines/our-wms/2026-11-27-pre-ozon-sequential. Request3394 recovery must preserve successful Ufa, send only Yaroslavl, verify composition and unchanged physical/billing evidence, then prove replay no-op.
