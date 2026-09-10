// TEST: release verifier rejects changed, missing and additional upload artifacts.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { verify, sources, base, sha, artifactDiff } = require('./wb-reshipment-release.cjs');
test('closed source allowlist and hash verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-reshipment-proof-'));
  try {
    const files = {};
    for (const name of sources) {
      const p = path.join(root, 'candidate', name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, name);
      files[name] = { next: sha(name), before: null };
    }
    const manifest = { base, head: 'a'.repeat(40), files }; verify(root, manifest);
    const target = path.join(root, 'candidate', sources[0]); fs.writeFileSync(target, 'mixed release'); assert.throws(() => verify(root, manifest));
    fs.writeFileSync(target, sources[0]); fs.writeFileSync(path.join(root, 'candidate', 'extra'), 'no'); assert.throws(() => verify(root, manifest));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('artifact verifier rejects replaced downloads and unrelated API files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-reshipment-diff-'));
  try {
    const a = path.join(root, 'a'), b = path.join(root, 'b');
    for (const [kind, file] of [['web', '/usr/share/nginx/html/downloads/app.apk'], ['api', '/app/apps/api/dist/modules/stock/stock.service.js']]) {
      fs.writeFileSync(a, `${'a'.repeat(64)}  ${file}\n`); fs.writeFileSync(b, `${'b'.repeat(64)}  ${file}\n`);
      assert.throws(() => artifactDiff(kind, a, b));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
