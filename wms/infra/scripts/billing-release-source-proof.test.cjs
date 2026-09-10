// TEST: candidate bytes must be reachable from the exact approved Git commit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { sourcePaths, createSourceProof, verifySourceProof } = require('./billing-release-source-proof.cjs');

const objectId = (type, bytes) => crypto.createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-source-proof-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hierarchy = {}, objects = new Map(), trees = {};
  const files = new Map(sourcePaths.map(name => [name, Buffer.from(`// fixture ${name}\n`)]));
  for (const [name, bytes] of files) {
    const parts = name.split('/'); let node = hierarchy;
    for (const part of parts.slice(0, -1)) node = node[part] ||= {};
    const oid = objectId('blob', bytes); objects.set(oid, { type: 'blob', bytes });
    node[parts.at(-1)] = { oid };
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  if (options.unsafeName) hierarchy[options.unsafeName] = { oid: [...objects.keys()][0] };
  function tree(node) {
    const bytes = Buffer.concat(Object.entries(node).sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av.oid ? '' : '/')), Buffer.from(b + (bv.oid ? '' : '/')))).map(([name, value]) =>
      Buffer.concat([Buffer.from(`${value.oid ? options.leafMode || '100644' : '40000'} ${name}\0`), Buffer.from(value.oid || tree(value), 'hex')])));
    const oid = objectId('tree', bytes); objects.set(oid, { type: 'tree', bytes }); trees[oid] = bytes.toString('base64'); return oid;
  }
  const treeId = tree(hierarchy);
  const commit = Buffer.from(`tree ${treeId}\nauthor QA <qa@example.test> 1 +0000\ncommitter QA <qa@example.test> 1 +0000\n\nSynthetic fixture\n`);
  const head = objectId('commit', commit); objects.set(head, { type: 'commit', bytes: commit });
  return { root, files, objects, head, proof: { version: 1, commit: commit.toString('base64'), trees } };
}

test('accepts the exact eighteen reviewed API/web source files', t => {
  const f = fixture(t); assert.equal(sourcePaths.length, 18);
  assert.deepEqual(sourcePaths.filter(name => name.startsWith('wms/apps/api/')),
    require('./billing-release-artifacts.cjs').apiModules.map(name => `wms/apps/api/src/${name}.ts`));
  assert.equal(verifySourceProof(f.proof, f.root, f.head).head, f.head);
});
test('rejects a different approved head even with internally consistent object hashes', t => {
  const f = fixture(t); assert.throws(() => verifySourceProof(f.proof, f.root, '0'.repeat(40)), /commit/i);
});
test('rejects tampered commit and tree contents', t => {
  const f = fixture(t);
  assert.throws(() => verifySourceProof({ ...f.proof, commit: Buffer.from('changed').toString('base64') }, f.root, f.head), /commit/i);
  const key = Object.keys(f.proof.trees)[0]; f.proof.trees[key] = Buffer.from('changed').toString('base64');
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /tree/i);
});
test('rejects missing tree proofs', t => {
  const f = fixture(t); delete f.proof.trees[Object.keys(f.proof.trees)[0]];
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /tree/i);
});
test('rejects changed and missing source files', t => {
  const f = fixture(t), file = path.join(f.root, sourcePaths[0]); fs.appendFileSync(file, '\nchanged');
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /source.*mismatch/i);
  fs.unlinkSync(file); assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /missing/i);
});
test('rejects an extra untracked source and unexpected directory', t => {
  const f = fixture(t), extra = path.join(f.root, 'wms/apps/web/src/unreviewed.ts'); fs.writeFileSync(extra, 'untracked');
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /unexpected/i);
  fs.unlinkSync(extra); fs.mkdirSync(path.join(f.root, 'unreviewed'));
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /unexpected/i);
});
test('rejects directory symlinks/junctions without following them', t => {
  const f = fixture(t), link = path.join(f.root, 'linked'); fs.symlinkSync(path.join(f.root, 'wms'), link, 'junction');
  assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /symlink/i);
});
test('rejects committed symlinks and submodules even under the reviewed paths', t => {
  for (const leafMode of ['120000', '160000']) {
    const f = fixture(t, { leafMode });
    assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /not a regular file/i);
  }
});
test('rejects traversal and absolute names in otherwise hash-consistent trees', t => {
  for (const unsafeName of ['..', '/absolute', 'parent/child', 'parent\\child']) {
    const f = fixture(t, { unsafeName });
    assert.throws(() => verifySourceProof(f.proof, f.root, f.head), /unsafe.*path/i);
  }
});
test('rejects noncanonical base64 and malformed head arguments', t => {
  const f = fixture(t);
  assert.throws(() => verifySourceProof({ ...f.proof, commit: `${f.proof.commit}\n` }, f.root, f.head), /base64/i);
  assert.throws(() => verifySourceProof(f.proof, f.root, '../HEAD'), /head/i);
});
test('generator reads immutable Git objects and ignores working-tree changes', t => {
  const f = fixture(t), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-source-git-test-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-b', 'feature/proof-fixture', repo], { stdio: 'pipe' });
  for (const [oid, { type, bytes }] of f.objects) {
    const actual = execFileSync('git', ['-C', repo, 'hash-object', '-w', '-t', type, '--stdin'], { input: bytes }).toString().trim();
    assert.equal(actual, oid);
  }
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'not a release source');
  const proof = createSourceProof(repo, f.head);
  assert.equal(verifySourceProof(proof, f.root, f.head).head, f.head);
  // Both CLI directions are exercised against an isolated synthetic Git object database.
  const cli = path.join(__dirname, 'billing-release-source-proof.cjs');
  const emitted = JSON.parse(execFileSync(process.execPath, [cli, 'create', repo, f.head]).toString());
  const proofFile = path.join(repo, 'proof.json'); fs.writeFileSync(proofFile, JSON.stringify(emitted));
  assert.match(execFileSync(process.execPath, [cli, 'verify', proofFile, f.root, f.head]).toString(), /SOURCE_PROOF_PASS/);
  assert.throws(() => createSourceProof(repo, '--all'), /head/i);
});
