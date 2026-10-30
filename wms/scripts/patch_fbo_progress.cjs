// FIX: apply only the reviewed delta to a separately verified production snapshot.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const root = path.resolve(process.argv[2]);
const file = path.join(root, 'modules/tsd/fbo-two-stage.service.js');
let code = fs.readFileSync(file, 'utf8');
function replace(old, next) {
  if (code.split(old).length !== 2) throw new Error('Production anchor changed: ' + old);
  code = code.replace(old, next);
}
replace('"use strict";', '"use strict";\nconst fboProgressStatus = require("./fbo-progress-status");');
replace("else if (dto.action === 'FINISH_PICK') {\n                    requirePhase('PICKING');",
  "else if (dto.action === 'FINISH_PICK') {\n                    if (!(fboProgressStatus.fboProgressStatusEnabled() && a.phase === 'PACKING')) requirePhase('PICKING');");
replace('                await tx.fboAssemblyAction.create({ data: { id: key, requestId: id, payloadHash, actorId: user.id } });',
  '                await fboProgressStatus.reconcileFboProgress(tx, id, user.id);\n                await tx.fboAssemblyAction.create({ data: { id: key, requestId: id, payloadHash, actorId: user.id } });');
replace("error.code !== 'P2034' || attempt >= 2", "!fboProgressStatus.fboRetryableTransactionError(error) || attempt >= 2");
const source = fs.readFileSync(path.join(__dirname, '../apps/api/src/modules/tsd/fbo-progress-status.ts'), 'utf8');
const built = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
if (built.diagnostics?.length) throw new Error('Compilation diagnostics');
fs.writeFileSync(path.join(root, 'modules/tsd/fbo-progress-status.js'), built.outputText);
fs.writeFileSync(file, code);
function patchModule(name, changes) {
  const p = path.join(root, 'modules', name + '.js');
  let text = fs.readFileSync(p, 'utf8');
  for (const [before, after] of changes) {
    if (text.split(before).length !== 2) throw new Error('Production anchor changed: ' + name + ': ' + before);
    text = text.replace(before, after);
  }
  fs.writeFileSync(p, text);
}
patchModule('client-requests/client-requests.service', [[
  'const previousAttempts = await',
  "const progressLabels = await require('../tsd/fbo-progress-status').fboProgressLabels(this.prisma, requests.filter(r => r.type === 'OUTBOUND' && !r._count.fbsOrderLinks).map(r => r.id));\n        for (const request of requests) if (progressLabels[request.id]) Object.assign(request, { fboProgressLabel: progressLabels[request.id] });\n        const previousAttempts = await"
]]);
patchModule('client-requests/ozon-fbo-import.service', [[
  'return rows.map(r => ({ id: r.id, number: r.number, title: r.title, status: r.status,',
  "const progressLabels = await require('../tsd/fbo-progress-status').fboProgressLabels(this.db, rows.map(r => r.id));\n        return rows.map(r => ({ id: r.id, number: r.number, title: r.title, status: r.status, fboProgressLabel: progressLabels[r.id],"
]]);
patchModule('lamoda/lamoda.service', [[
  'return { products, documents, plans, exchanges, externalWritesEnabled: false,',
  "const progressLabels = await require('../tsd/fbo-progress-status').fboProgressLabels(this.db, plans.flatMap(p => p.assembly ? [p.assembly.requestId] : []));\n        for (const plan of plans) if (plan.assembly?.request && progressLabels[plan.assembly.requestId]) Object.assign(plan.assembly.request, { fboProgressLabel: progressLabels[plan.assembly.requestId] });\n        return { products, documents, plans, exchanges, externalWritesEnabled: false,"
]]);
