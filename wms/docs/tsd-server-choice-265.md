# TSD server-choice265: Ozon box-first picking

Published 20.11.2026 through PR1034.

The ordinary 264-box-direct-v1 channel includes PR1029, but server-choice264-packing-modes did not include its FboScanState change. Ozon picking therefore still required a pallet before a box.

The candidate overlays only FboScanState from the verified published ordinary264 onto published server-choice264. Method-level verification permits only scanLocation to change. Version metadata and the one monitoring version string advance to265. All other classes, resources, package identity, certificate, session, queue and checkpoint code remain unchanged. A first box scan selects its parent pallet only from the server-verified picking route. Explicit wrong pallets, unknown boxes and unavailable stock remain rejected. No stock mutation occurs on location scan.

Validation: the new Ozon screen regression fails against the old condition and passes with PR1029. LogoffDebug354 and LogoffServers354 pass. Full Ffullhab354 has two existing failures in ReceiptPlacementActivityTest and ReceiptProgressActivityTest; both reproduce in isolation with unchanged production source and unchanged receipt tests. Sold APK is not built or published. Release guards13 pass; actual APK method/class/resource/package/signature checks pass.

Build tooling: apps/android-tsd/servers265. Proof: build-proof.json there. Publisher requires merged PR, exact live channel hashes, health, unchanged containers and ordinary channel, and rolls back feed/config on failure. Source/runtime parity remains false; this is an exact published APK overlay, not a full source rebuild. Owner terminal reports0.1.265-box-direct-v1 after the standard UPDATE_APP command. Before/after comparison preserved1439 assembly-unit IDs and55727 operation IDs across five devices, all worker identities and request compositions. Physical first-box confirmation remains pending. Other four devices report264; Konstantin has now successfully upgraded from261. Public265 APK hash, both server-channel routes, API health, unchanged containers and ordinary APK/feed were verified.
