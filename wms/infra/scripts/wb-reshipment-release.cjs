// FIX: narrow, hash-verified release overlay; no worktree/env files in artifacts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const base = '7c38ff85f55471d5199ab1a8d32dd3a34b492927';
const api = [
  'common/shipment-history/fbs-attempt-history', 'modules/administration/administration-internal-api.service',
  ...['dto/fbs-reshipment.dto', 'fbs-reshipment-transition', 'fbs-reshipment.controller', 'fbs-reshipment.service',
    'fbs-reshipment', 'marketplace-connections.module', 'marketplace-connections.service'].map(p => `modules/marketplace-connections/${p}`),
];
const sources = [...api.map(p => `wms/apps/api/src/${p}.ts`),
  'wms/apps/api/prisma/schema.prisma', 'wms/apps/api/prisma/migrations/20260910144000_fbs_reshipment/migration.sql',
  ...['components/fbs/FbsPanel.tsx', 'components/fbs/FbsReshipmentPanel.tsx', 'lib/api.ts'].map(p => `wms/apps/web/src/${p}`)];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function schemaBaseline(live, committed) {
  // FIX: live Prisma metadata predates the already deployed raw-SQL sorting table.
  // This is the sole reviewed exception; it cannot mask another field/model change.
  assert.equal(sha(live), 'a737d498218ffb0fedbc89d2056f703b8cb90b7ffb0c6f34ff7b4fbdbb3a6a3a');
  const withoutSorting = committed.toString().replace(/\/\/ ADDED: independent admin sorting sessions; no FBS request or stock reservation\.\r?\nmodel PalletSortingSession \{[^}]+\}\r?\n\r?\n/, '');
  assert.notEqual(withoutSorting, committed.toString());
  assert.equal(withoutSorting.replace(/\r\n/g, '\n'), live.toString().replace(/\r\n/g, '\n'));
}
function put(root, name, bytes) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
function walk(root, prefix = '') { return fs.readdirSync(path.join(root, prefix)).flatMap(n => {
  const p = prefix ? `${prefix}/${n}` : n; const s = fs.lstatSync(path.join(root, p)); assert(!s.isSymbolicLink(), 'No artifact symlinks');
  return s.isDirectory() ? walk(root, p) : [p];
}); }
function verify(root, manifest) {
  assert.equal(manifest.base, base); assert.match(manifest.head, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(manifest.files).sort(), [...sources].sort());
  assert.deepEqual(walk(path.join(root, 'candidate')).sort(), [...sources].sort());
  for (const [name, proof] of Object.entries(manifest.files)) {
    assert.equal(sha(fs.readFileSync(path.join(root, 'candidate', name))), proof.next, `Candidate drift ${name}`);
    if (proof.before) assert.equal(sha(fs.readFileSync(path.join(root, 'baseline', name))), proof.before, `Baseline drift ${name}`);
  }
}
function pack(out) {
  const git = args => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
  assert.equal(git(['diff', '--name-only', 'HEAD']).toString().trim(), '', 'Commit reviewed code first');
  const head = git(['rev-parse', 'HEAD']).toString().trim();
  fs.mkdirSync(out); const files = {};
  const oldFiles = new Set(git(['ls-tree', '-r', '--name-only', base]).toString().trim().split('\n'));
  for (const p of sources) {
    const bytes = git(['show', `${head}:${p}`]); put(path.join(out, 'candidate'), p, bytes);
    files[p] = { next: sha(bytes), before: null };
    if (oldFiles.has(p)) { const old = git(['show', `${base}:${p}`]); put(path.join(out, 'baseline'), p, old); files[p].before = sha(old); }
  }
  const support = git(['ls-tree', '-r', '--name-only', head]).toString().trim().split('\n').filter(p =>
    /^wms\/apps\/api\/test\/(fbs-reshipment[^/]*|administration-internal-api.service.spec.ts|billing-live-compat.spec.ts)$/.test(p) ||
    /^wms\/infra\/(wb-reshipment.Dockerfile|scripts\/wb-reshipment[^/]*)$/.test(p));
  for (const p of support) put(out, p, git(['show', `${head}:${p}`]));
  const manifest = { base, head, files }; put(out, 'manifest.json', JSON.stringify(manifest, null, 2)); verify(out, manifest);
  console.log(JSON.stringify({ head, files: sources.length, out }));
}
function overlay(root) {
  for (const p of api) for (const [dir, ext] of [['src', 'ts'], ['dist', 'js']]) {
    const name = `app/apps/api/${dir}/${p}.${ext}`; put(root, name, fs.readFileSync(`/${name}`));
  }
  for (const p of sources.filter(p => p.startsWith('wms/apps/api/prisma/'))) {
    const name = p.replace(/^wms\//, 'app/'); put(root, name, fs.readFileSync(`/${name}`));
  }
  const entry = require.resolve('@prisma/client', { paths: ['/app/apps/api'] });
  const generated = path.dirname(require.resolve('.prisma/client/default', { paths: [entry] }));
  assert(generated.startsWith('/app/node_modules/.pnpm/') && generated.endsWith('/node_modules/.prisma/client'));
  fs.cpSync(generated, path.join(root, generated.slice(1)), { recursive: true });
}
function artifactDiff(kind, beforeFile, afterFile) {
  const read = p => new Map(fs.readFileSync(p, 'utf8').trim().split('\n').map(l => { const m = /^([a-f0-9]{64})\s+(.+)$/.exec(l); assert(m); return [m[2], m[1]]; }));
  const before = read(beforeFile), after = read(afterFile); let changed = 0;
  const allowed = new Set(api.flatMap(p => [`/app/apps/api/src/${p}.ts`, `/app/apps/api/dist/${p}.js`]));
  for (const [p, hash] of before) {
    assert(after.has(p), `Removed live artifact ${p}`);
    if (hash !== after.get(p)) { changed++; assert(kind === 'api' ? allowed.has(p) : p === '/usr/share/nginx/html/index.html', `Unexpected replacement ${p}`); }
  }
  for (const p of after.keys()) if (!before.has(p)) {
    changed++; assert(kind === 'api' ? allowed.has(p) : /^\/usr\/share\/nginx\/html\/assets\/[^/]+$/.test(p), `Unexpected new artifact ${p}`);
  }
  assert(changed > 0); console.log(`${kind} artifact allowlist PASS: ${changed} changed/new files`);
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'pack') pack(args[0]);
  else if (mode === 'verify') { verify(args[0], JSON.parse(fs.readFileSync(path.join(args[0], 'manifest.json')))); console.log('SOURCE_MANIFEST_PASS'); }
  else if (mode === 'overlay') overlay(args[0]);
  else if (mode === 'artifacts') artifactDiff(...args);
  else throw Error('pack|verify|overlay|artifacts');
}
module.exports = { verify, sources, base, sha, artifactDiff, schemaBaseline };
