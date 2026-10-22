# Receipt directions for client managers

CLIENT users with writableClientIds can preview and save FBS/FBO receipt directions for those clients. Read-only, foreign-client, foreign-branch, demo and disabled-installation cases remain denied. ADMIN/OWNER retain active branch and permission guards. The UI uses the server capability and sends the receipt warehouse. Box reassignment remains administrative. No personal grants or role changes are required.

Changed: receipt-direction-access.ts, ReceiptChannelsController list/change and method permissions, ReceiptDirectionsPanel capability and payload. Existing optimistic revision checks, transaction, audit and reservation protections remain intact.

Validation: API 3550 passed / 155 skipped; web 465 passed / 2 skipped; both TypeScript checks passed. Dedicated KIZ DB integration suite excluded because its separate DB is not configured. New scope regression fails before the fix. Actual candidate browser: 9 scenarios, including manager save, read-only denial and existing native confirmation behavior. Actual API candidate: 11 cases.

Release uses exact current images captured on 22 October: API 08af8a29243c287dbfa501d3730da64ee09aa1d68cea7d9268af65e5fc4789e8; web d030444578d5412e7cbf86c0bf97e66ade14e89b0afb4562098430775017f15e. Two API modules and two web files only. The runtime receipt visibility implementation differs from source and is preserved verbatim; sourceParityVerified remains false. Current invoice downloads, favorites and native receipt confirmation are retained. No configuration, business data, schema, APK or sold WMS changes.

Target: feature/wb-print-check through PR. Published in PR659 on 22 October 2026. Live capability checks passed for Svetlana and manager, plus read-only denial; downloaded public JavaScript passes all nine browser scenarios. Rollback: logoff-api:before-receipt-manager-20261022 and logoff-web:before-receipt-manager-20261022. Current image hashes are recorded in baseline 2026-10-22-receipt-manager.
