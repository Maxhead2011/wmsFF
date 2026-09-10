// FIX: prove the exact release overlay through Git objects, independently of the worktree.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Deliberately independent of the artifact verifier: no circular imports or caller-supplied paths.
const sourcePaths = Object.freeze([
  ...[
    'modules/administration/administration-internal-api.service',
    'modules/billing/billing.controller',
    'modules/billing/billing.module',
    'modules/billing/billing.service',
    'modules/billing/dto/list-billing-invoices.dto',
    'modules/billing/request-billing-automation.service',
    'modules/marketplace-connections/marketplace-connections.service',
    'modules/billing/billing-mutation',
    'modules/billing/billing-period-policy',
    'modules/billing/billing-period.service',
    'modules/billing/dto/generate-billing-period.dto',
  ].map(name => `wms/apps/api/src/${name}.ts`),
  ...[
    'components/billing/BillingPanel.tsx',
    'components/billing/BillingInvoicesTable.tsx',
    'components/billing/BillingPeriodGenerationDialog.tsx',
    'components/billing/billing.css',
    'lib/api.ts',
    'components/fbs/FbsPanel.tsx',
    'components/fbs/fbs.css',
  ].map(name => `wms/apps/web/src/${name}`),
]);
const maxProofBytes = 16 * 1024 * 1024;
const sha1Pattern = /^[a-f0-9]{40}$/;
function requireHead(head) { assert(typeof head === 'string' && sha1Pattern.test(head), 'Expected full SHA-1 Git head'); }
function gitObjectId(type, bytes) {
  return crypto.createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}
function decodeBase64(value) {
  assert(typeof value === 'string' && value.length <= maxProofBytes, 'Invalid base64 proof');
  const bytes = Buffer.from(value, 'base64');
  assert(bytes.toString('base64') === value, 'Noncanonical base64 proof');
  return bytes;
}
function rootTree(commit, head) {
  requireHead(head);
  assert.equal(gitObjectId('commit', commit), head, 'Git commit hash mismatch');
  const match = /^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'));
  assert(match, 'Commit has no root tree');
  return match[1];
}
function parseTree(bytes, oid) {
  assert(sha1Pattern.test(oid) && gitObjectId('tree', bytes) === oid, 'Git tree hash mismatch');
  const entries = new Map(); let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, offset);
    assert(space > offset && nul > space + 1 && nul + 21 <= bytes.length, 'Malformed Git tree entry');
    const mode = bytes.subarray(offset, space).toString('ascii');
    const nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString('utf8');
    assert(Buffer.from(name).equals(nameBytes) && !/[\\/]/.test(name) && name !== '.' && name !== '..', 'Unsafe Git tree path');
    assert(!entries.has(name), 'Duplicate Git tree path');
    entries.set(name, { mode, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') });
    offset = nul + 21;
  }
  return entries;
}
function resolveLeaves(commit, head, readTree) {
  const root = rootTree(commit, head), leaves = new Map();
  for (const file of sourcePaths) {
    let treeId = root;
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      const entry = readTree(treeId).get(parts[i]);
      assert(entry, `Missing committed source: ${file}`);
      if (i < parts.length - 1) {
        assert(entry.mode === '40000' || entry.mode === '040000', `Not a committed source directory: ${file}`);
        treeId = entry.oid;
      } else {
        assert(entry.mode === '100644' || entry.mode === '100755', `Committed source is not a regular file: ${file}`);
        leaves.set(file, entry.oid);
      }
    }
  }
  return leaves;
}
function createSourceProof(repository, head) {
  requireHead(head);
  const read = (type, oid) => execFileSync('git', ['-C', path.resolve(repository), 'cat-file', type, oid], { maxBuffer: maxProofBytes });
  const commit = read('commit', head), trees = Object.create(null), cache = new Map();
  resolveLeaves(commit, head, oid => {
    if (!cache.has(oid)) {
      const bytes = read('tree', oid); cache.set(oid, parseTree(bytes, oid)); trees[oid] = bytes.toString('base64');
    }
    return cache.get(oid);
  });
  return { version: 1, commit: commit.toString('base64'), trees };
}
function verifySourceProof(proof, candidateRoot, expectedHead) {
  requireHead(expectedHead);
  assert(proof && proof.version === 1 && proof.trees && typeof proof.trees === 'object' && !Array.isArray(proof.trees), 'Invalid source proof');
  assert(Buffer.byteLength(JSON.stringify(proof)) <= maxProofBytes, 'Source proof too large');
  const trees = new Map(Object.entries(proof.trees).map(([oid, value]) => [oid, parseTree(decodeBase64(value), oid)]));
  const visited = new Set();
  const leaves = resolveLeaves(decodeBase64(proof.commit), expectedHead, oid => {
    assert(trees.has(oid), `Missing Git tree proof: ${oid}`); visited.add(oid); return trees.get(oid);
  });
  assert.equal(visited.size, trees.size, 'Unreferenced Git tree proof');
  const allowedFiles = new Set(sourcePaths), allowedDirectories = new Set(['']);
  for (const name of sourcePaths) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) allowedDirectories.add(parts.slice(0, i).join('/'));
  }
  const root = path.resolve(candidateRoot), found = new Set();
  function inspect(relative) {
    const target = path.join(root, ...relative.split('/')), stat = fs.lstatSync(target);
    assert(!stat.isSymbolicLink(), `Candidate symlink forbidden: ${relative || '.'}`);
    if (stat.isDirectory()) {
      assert(allowedDirectories.has(relative), `Unexpected candidate directory: ${relative}`);
      for (const name of fs.readdirSync(target)) {
        assert(!/[\\/]/.test(name) && name !== '.' && name !== '..', 'Unsafe candidate path');
        inspect(relative ? `${relative}/${name}` : name);
      }
    } else {
      assert(stat.isFile() && allowedFiles.has(relative), `Unexpected candidate file: ${relative}`);
      const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        assert(fs.fstatSync(fd).isFile(), `Candidate is not a regular source: ${relative}`);
        assert.equal(gitObjectId('blob', fs.readFileSync(fd)), leaves.get(relative), `Source hash mismatch: ${relative}`);
      } finally { fs.closeSync(fd); }
      found.add(relative);
    }
  }
  inspect('');
  for (const name of sourcePaths) assert(found.has(name), `Missing candidate source: ${name}`);
  return { head: expectedHead, files: found.size };
}

if (require.main === module) {
  const [mode, a, b, c] = process.argv.slice(2);
  if (mode === 'create' && a && b && !c) process.stdout.write(`${JSON.stringify(createSourceProof(a, b))}\n`);
  else if (mode === 'verify' && a && b && c) {
    assert(fs.statSync(a).size <= maxProofBytes, 'Source proof too large');
    verifySourceProof(JSON.parse(fs.readFileSync(a, 'utf8')), b, c);
    console.log('BILLING_RELEASE_SOURCE_PROOF_PASS');
  } else throw new Error('Usage: create <repository> <head> | verify <proof.json> <candidate-root> <head>');
}
module.exports = { sourcePaths, createSourceProof, verifySourceProof };
