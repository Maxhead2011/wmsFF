Published PR547 / 2026-10-10: LOGOFF APK225 displays barcode, product, size, destination quantity and packed/remaining counts for the selected Ozon destination. Existing response only; no added requests. 245 Android tests per flavor (735 total), release/lint and signed package checks passed. Regression reproduced before fix. Physical scanner verification pending installation. Only three APK download files changed; API, print agent, flags, sold WMS and stock unchanged. Baseline `2026-10-10-ozon-direction-items`, sourceParityVerified=false.

Published PR545 / 2026-10-10: Ozon packing command now counts loaded units for unoptimized progress. Existing parallel-packing flag required; final phase and direction guards preserved. API3276/web414 and four runtime guard tests passed; API139/web2 skipped, dedicated KIZ integration excluded. Tests stop before physical mutation; production snapshot is read-only and excludes route allocation. APK224, web, sold WMS and business records unchanged. Baseline `2026-10-10-ozon-packing-command`, sourceParityVerified=false.

# LOGOff Фулфилмент

Проект очищен под новую WMS. Сейчас оставлена только статическая заглушка с красным логотипом и названием компании.

Открыть локально: `index.html`.
