# LOGOFF TSD 260 — standard Sofia voice and receipt feedback

Scope: LOGOFF only. Sofia uses the existing standard FBO WB recordings; Eleonora retains her personal voice. No new audio assets. Unused Sofia assets remain bundled but are never selected. Sold flavors have no receipt speech and retain their versions.

MainActivity receipt hooks prompt barcode after confirmed carton opening, KIZ after marked-product lookup and PUT after local carton entry. PUT is an instruction, not a claim of server persistence. Invalid scans and duplicate KIZ use existing ERROR audio. Exact unboxed APPLIED/REJECTED replies drive success/failure; pending or missing replies do not sound successful. Boxed receipt success waits for confirmed close. Audio is gated by the active receipt screen, session, LOGOFF flavor and Activity lifecycle; leaving receipt closes pending sound playback.

Files: PersonalScanVoice.java (account/resource selection); MainActivity.java (receipt prompts/results and lifecycle); SofiaTankVoiceTest.java and ReceiptVoiceActivityTest.java; LOGOFF version in app/build.gradle.kts. API/web, stock, reservations, receipt persistence and sold application versions are unchanged. Ozon product-first packing from259 is preserved.

Regression: Sofia standard-audio test and receipt PUT test both failed against old code (RED). Real Retrofit test responses cover marked barcode, accepted/rejected/missing receipt result; no sound repetition on redraw and no background success. Full flavor suites and signed artifacts are recorded in releases/tsd-receipt-voice-260.json. Existing sold-flavor receipt-test failures are documented in ozon-product-only.md; no physical terminal claim is made.

Publication: APK-only through PR to feature/la_panthera, two package identities and the published259 signing certificate. Immutable download files, metadata channels and default original-package alias update together with rollback and unchanged-container verification. Physical audio/scanner check remains required after installation.

Validation completed: LOGOFF352 passed; ffullhab/platform each342 passed,8 skipped,2 previously documented receipt failures. API4660 passed/9 skipped (dedicated DB integration excluded), web622 passed/2 skipped. Both signed package manifests/certificates and actual APK receipt helper payload verified.
