# Restore label-free terminal confirmation

Updated LOGOFF terminals send `X-TSD-FBS-Capability: physical-pick-v1`.
The published service requires this capability plus
`WMS_TSD_PHYSICAL_PICK_CONFIRMATION=true`. The published controller used
`CurrentUser` and discarded the header, so both marketplaces returned the legacy
label workflow. The capability helper existed but was not used by the controller.

The fix forwards the capability on nine assembly endpoints, including scan,
resume, undo and completion. Authentication and permissions are unchanged.
Relabel target-SKU printing remains separate from order-label presentation.
No APK, inventory, routing or marketplace service replacement is required.

Shared module warning: the TSD controller is shared with the sold installation.
Only our installation is deployed. The capability is presentation metadata;
the existing runtime deployment flag remains the gate and the disabled-flag
case is tested. No sold configuration is changed.

## Verification

- Nine controller parameter tests failed on both parent source and downloaded
  production controller, then passed after the fix.
- Twelve production-derived runtime checks passed: real Nest parameter factories,
  WB sticker digits, Ozon confirmation without calling the label loader, Ozon
  3-unit progress/completion guard, sequential picking and disabled flags.
- API suite: 2,750 passed, 94 skipped; external database integration file
  `kiz-duplicate.integration.spec.ts` excluded because its dedicated test database
  was not configured. Skipped tests are not claimed as passing.
- Android LOGOFF unit tests: 215 passed. Web: 227 passed. TypeScript build passed.
- Candidate container smoke check passed with network disabled.

The runtime checks accept `FBS_RUNTIME_CONTROLLER` (absolute compiled controller
path) and `FBS_RUNTIME_ENTRY` (absolute compiled marketplace service path).
Run `test/tsd-fbs-capability.spec.ts` and `test/fbs-tsd-sticker-number.spec.ts`
with both set to validate an actual release, not just source.

## Publication

`manifest.json` binds the controller patch to the inspected production image.
Apply only `runtime-controller.patch` and the compiled
`tsd-fbs-user.decorator.ts`. Verify that exactly those two dist files change.
The marketplace service and all other dist files must remain byte-identical.
Acquire the release lock, recheck the base image before switching, and retain
the old image for health-check rollback. A full source rebuild is not covered
by this narrow release: pre-existing source/runtime differences remain.
