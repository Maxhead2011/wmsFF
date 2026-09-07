#!/usr/bin/env bash
set -euo pipefail
umask 077
b=/opt/logoff-wms-backups/sorting-recovery-20260907
r=/tmp/sorting-recovery-release-20260907
test -s "$b/staged-at"
# TEST: compiled live weight policy is retained, not merely its source text.
docker run --rm --network none -w /app/apps/api infra-api:sorting-recovery-20260907 node -e 'const a=require("node:assert/strict"),s=require("./dist/modules/stock/stock-operations.service");const r=s.validateBoxWeight("TEST",{},[{quantity:30,skuWeightGrams:1000}],false);a.equal(r.calculatedWeightGrams,30000);a.equal(r.warnings[0].code,"BOX_CALCULATED_WEIGHT_OVER_LIMIT");console.log("WEIGHT_POLICY_PRESERVED")' > "$b/weight-test.log"
# TEST: all runtime tests, no network, no production environment file or credentials.
docker run --rm --network none -e NODE_ENV=test -e WMS_TEST_OUR_LIVE_BASELINE=true \
 -e WMS_PERMANENT_STORAGE_BOXES_ENABLED=false -e WMS_TSD_PHYSICAL_STOCK_RECONCILIATION_ENABLED=false \
 -v "$r/pallet-sorting-recovery.spec.ts:/app/apps/api/test/pallet-sorting-recovery.spec.ts:ro" \
 -v "$r/permanent-return-live-adapter.cjs:/app/infra/scripts/permanent-return-live-adapter.cjs:ro" \
 -v "$r/repair-lknov039-confirmed-empty.ts:/app/apps/api/src/scripts/repair-lknov039-confirmed-empty.ts:ro" \
 -w /app/apps/api infra-api:sorting-recovery-20260907 node node_modules/vitest/vitest.mjs run > "$b/full-tests.log" 2>&1
bash "$r/sorting-recovery-postgres.sh" > "$b/postgres-tests.log" 2>&1
grep -q '"result":"PASS"' "$b/postgres-tests.log"
date -u +'%Y-%m-%dT%H:%M:%SZ' > "$b/full-tests-passed"
echo CANDIDATE_TESTS_PASS
