#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/tsd-admin-recount-20260907
# TEST: compare the entire runtime suite against the exact running baseline.
for variant in baseline candidate; do
  if test "$variant" = baseline; then image=$(cat "$b/api-image.txt"); else image=infra-api:tsd-recount-20260907; fi
  status=0
  docker run --rm --network none -v "$b:/results" -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false -w /app/apps/api "$image" node node_modules/vitest/vitest.mjs run --reporter=json --outputFile="/results/full-$variant.json" --maxWorkers=1 --minWorkers=1 > "$b/full-$variant.log" 2>&1 || status=$?
  test "$status" -le 1
  test -s "$b/full-$variant.json"
  echo "FULL_${variant}_FINISHED"
done
node /tmp/tsd-recount-full-compare.cjs > "$b/full-comparison.json"
cat "$b/full-comparison.json"
