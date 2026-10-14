# Eleonora account correction

Prepared 2026-10-14; not published. The previous release used Elya's ID from legacy code. Read-only production lookup established separate accounts: login `эля`, ID d65d6258-d4e8-4bc1-b1cf-583d1a1e4c82; login `элеонора`, display name `Элькапоне`, ID 8e175b30-8535-4881-9324-a875c9fd8c1d. Winx welcome now belongs to the latter. Sofia is unchanged.

Only welcomeStyle account binding changes. Runtime builder changes exactly one account-ID literal within the appearance bundle in fresh web d84c5629, then renames the graph for cache invalidation (33 files). API853c97df, APK232, CSS/media, configuration, warehouse operations and sold WMS are unchanged. sourceParityVerified=false.

Regression: two unit assertions failed before correction (Eleonora unrecognized and Elya incorrectly assigned). Corrected actual-runtime fixtures use the real Eleonora account and verify six fresh logins, playback, exact text and skip/end/error across three themes. MAGIC_PUBLIC_ASSETS=1 makes the browser test fetch HTML/JS/CSS/media directly from the live site; only API authentication/data responses remain mocked, preventing business writes.

Validation: web442 passed/2 skipped; API3437 passed/150 skipped (dedicated KIZ DB suites excluded); TypeScript and baseline8 passed. Six corrected actual-runtime login cases passed.
