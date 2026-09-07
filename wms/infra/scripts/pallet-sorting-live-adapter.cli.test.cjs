// TEST: Linux-only release CLI safety, run on the isolated staging host (not the application).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
assert.equal(process.platform, 'linux', 'run this release-host test on Linux');
const cli = resolve(__dirname, 'pallet-sorting-live-adapter.cjs');
test('rejects a non-staging directory before reading or writing application files', () => {
  const result = spawnSync(process.execPath, [cli, '/tmp', '--warehouse'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /isolated staging directory required/);
});
test('rejects unreviewed registry bytes in both CLI modes without modifying them', () => {
  const root = mkdtempSync('/tmp/admin-sorting-pr63-check.');
  const directory = resolve(root, 'apps/api/src/modules/administration');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, 'administration-internal-api.service.ts');
  writeFileSync(file, 'synthetic unreviewed registry');
  try {
    for (const mode of ['--warehouse', '/tmp/does-not-exist-sorting-controller.ts']) {
      const result = spawnSync(process.execPath, [cli, root, mode], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /live registry changed/);
      assert.equal(readFileSync(file, 'utf8'), 'synthetic unreviewed registry');
    }
  } finally {
    assert.match(root, /^\/tmp\/admin-sorting-pr63-check\.[A-Za-z0-9]+$/);
    rmSync(root, { recursive: true });
  }
});
