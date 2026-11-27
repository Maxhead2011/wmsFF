# Managed TSD update 275

Validated release candidate for our server-choice package, PR1107. Public channel is switched only after merge by the guarded publisher. [Verification](releases/tsd-managed-update-verification.json).

Urovo DT40 normal authenticated idle path installed273 without system confirmation. All140 saved entries and4469 operation records were preserved. HT330 normal idle path installed final275 through the preinstalled Unitech AppCtrl service without system confirmation; all9 saved entries and its empty queue were preserved. One-time diagnostic bootstrap preceded these tests and is not counted as proof of automatic installation.

Final275 adds explicit Unitech_Electronics firmware matching and a150ms delay before the final barrier-focus check. The exact APK, signature and resource-preservation proof are linked above. All372 Android tests pass. No system protection was disabled, no WMS data cleared and no WMS uninstall performed. Diagnostic helpers were removed and temporary stay-awake settings restored.

Durable FBO positions and valid receipt drafts are preserved and do not block replacement. Actual pending commands/outbox entries, active work and malformed drafts still block. The scanner barrier must own focus before installation. Package identity, version and signing certificate are validated before OEM dispatch; uncertain OEM requests surface after90 seconds without immediate retransmission.

Supported OEMs: Urovo and Unitech/Unitech_Electronics. Unknown manufacturers retain the Android installer and may require confirmation. Previous267–270 installations can still need one-time bootstrap if their old guard blocks installation; automatic migration of every older device is not proven. Versions271–274 were internal tests, not public releases.

Scope: MainActivity.installUpdateApk/managedUpdateStatus and final focus dispatch, ManagedApkInstaller, IdleUpdateGuard.hasReceiptDraft, logoff manifest, Android version/dependency and tests. Release helpers: scripts/releases/tsd-managed-update-273 (final version275). No API/web images, stock, billing, standard270 channel or sold-WMS runtime changes. Source/runtime parity remains false; exact overlay of public270 is used.
