# Managed TSD update candidate 273

Status: unpublished; public server-choice feed remains 270 until physical verification and PR merge.

Only our server-choice package uses OEM installation: Urovo DeviceManager and the preinstalled system Unitech AppCtrl service. Package identity, version and exact signing certificate are validated before dispatch. No device-owner enrollment, Play Protect disabling, data clearing or WMS uninstall is used. Unknown manufacturers retain the existing Android installer.

Durable FBO position checkpoints and valid receipt drafts are preserved and no longer masquerade as unsent commands. Actual pending commands, outbox rows, active work and malformed drafts continue to block replacement. Installation takes scanner focus before rechecking durable queues. An unconfirmed OEM request is surfaced after 90 seconds without immediate retransmission.

## Verification

370 Android unit tests passed; exact signed APK overlays published 270, preserving other ZIP resources and legacy behavior. Candidate SHA-256: `109e6e24fe9f7d53c6168b61a6d7157dabe96e9abe3b37505c5a047b48e31306`.

Urovo OEM bootstrap accepted and replaced the process without a system confirmation. Normal idle-path verification and Unitech hardware verification remain required before publication. On Urovo, 75 rejected and 4394 synced records and saved work were retained. A logged-out terminal currently cannot enter the authenticated idle-update path; do not describe a cached APK as an installed update.

Physical test versions 271/272 are not public releases. Older installed versions may require one-time bootstrap to obtain the corrected update guard. Full unattended fleet migration from those versions is not yet established.

## Scope and source

Files: MainActivity.installUpdateApk/managedUpdateStatus, ManagedApkInstaller, IdleUpdateGuard.hasReceiptDraft, logoff manifest, Android build version/dependency and corresponding unit tests. Release helpers live under scripts/releases/tsd-managed-update-273. No API/web images, stock, billing or sold-WMS runtime change.

Official Unitech generated AIDL interface provenance is recorded alongside the dependency in app/libs. The OEM service itself is supplied by device firmware.
