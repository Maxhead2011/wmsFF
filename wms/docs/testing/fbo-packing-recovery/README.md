# FBO packing recovery

Branch: fix/fbo-packing-scan-recovery. Target PR: feature/fbo-packing-mode-choice.

- Cancel scan clears only the unsent product barcode. A pending request with unknown outcome stays retryable under its existing operation ID.
- Manual KIZ uses the scanned barcode and open target box. Existing picked units are packed without a second warehouse debit.
- An unknown valid KIZ may claim an AVAILABLE unit only from an active same-client/same-warehouse box associated with this request through a prior pick or explicit box selection. AVAILABLE quantity must exceed all non-shipping marks of the SKU in that box. Existing marks are preserved. Source choice is deterministic and recorded as inferred in FBO_MANUAL_UNLINKED_STOCK_CLAIM. This is accounting recovery, not evidence of the physical origin.
- If there is no eligible source, create a reconstructed RECEIPT dated 00:00 on the first day of the current Moscow month, then consume it at packing time through an isolated FBO-RECOVER holding box (ending at zero AVAILABLE). Preserve actual recording time and unknown origin in FBO_MANUAL_BACKDATED_RECEIPT audit. This changes historical stock and may affect storage billing, as explicitly authorized. All reconstruction and packing writes share the serializable transaction/idempotency key; failure rolls everything back. Cancel scan stays available after definitive rejection.
- Existing WMS_FBO_MANUAL_PACKING_ENABLED flag gates server behavior. Our Android flavor alone exposes recovery and packing voice.

## Speech

Bundled recordings; no device TTS required. PUT starts with the user-authorized recording 20260919_025859.m4a, decoded without changing speech or speed, followed by 0.1s silence and the Microsoft Irina barcode cue. Other phrases use Irina. Original recording metadata is not shipped.

| Asset | Spoken text |
|---|---|
| fbo_pack_box.wav | Скани́руй ко́роб. |
| fbo_pack_barcode.wav | Скани́руй барко́д. |
| fbo_pack_kiz.wav | Скани́руй киз. |
| fbo_pack_put.wav | Положи́ в ко́роб. Скани́руй барко́д. |
| fbo_pack_error.wav | Оши́бка. |

PUT includes both phrases to avoid cutting off the first phrase on redraw. The next physical scan interrupts obsolete speech. Error cues are emitted once per rejection/failed request, never on each redraw. Accent marks are synthesis input; pronunciation still requires listening review on the recordings/device.

## Release prerequisite

Do not publish an APK built directly from this older repository baseline. Integrate the patch into the exact published Android193 sources preserving durable fast receipts, saved position, routeStale guard and parallel packing. Recovery uses screenPhase(), cancellation persists the cleared checkpoint, and manual override must reset in both receipt and legacy success paths. Run that candidate's complete tests and upgrade test before publication. Production is unchanged by this task.

## Local verification

2026-09-19: repository API suite 2696 passed, 38 skipped (227 files passed, 2 skipped). Includes real PostgreSQL receipt/rollback/idempotency tests through the dedicated loopback test database. TypeScript noEmit passed. Android all six variant suites: 143 tests each, 858 executions, zero failures. Production overlay integration and deployment have not been performed. User supplied pronunciation sample 20260919_025859.m4a; user explicitly authorized using this recording; user-voice.json records conversion verification and hashes.
