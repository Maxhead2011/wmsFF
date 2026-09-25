// FIX: overlay only audited fragments onto the pinned runtime; never deploy the older full service build.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Supply a freshly materialized candidate directory');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, 'apps/api/src', file + '.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true },
}).outputText;
const fragment = (text, from, to) => {
  const start = text.indexOf(from), end = text.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw Error('Missing fragment: ' + from);
  return text.slice(start, end);
};
const replace = (text, before, after) => {
  if (text.split(before).length !== 2) throw Error('Ambiguous runtime anchor: ' + before.slice(0, 130));
  return text.replace(before, after);
};
const modulePath = 'modules/marketplace-connections/marketplace-connections.service';
const source = compile(modulePath);
const file = path.join(target, modulePath + '.js');
let runtime = fs.readFileSync(file, 'utf8');
runtime = replace(runtime, '"use strict";', '"use strict";\nconst ozon_fbs_pick_workflow_1 = require("./ozon-fbs-pick-workflow");\nconst ozon_fbs_pick_lines_1 = require("./ozon-fbs-pick-lines");');
const queueBlock = fragment(runtime, '    async getNextFbsTsdAssemblyUnlocked(', '\n    async ');
const queueSource = fragment(source, '    async getNextFbsTsdAssemblyUnlocked(', '\n    async ');
const demand = fragment(queueSource, '                    // FIX: two different articles', '                    if (sourceWithoutBox)');
let queueUpdated = replace(queueBlock, '                    if (sourceWithoutBox) {', demand + '                    if (sourceWithoutBox) {');
queueUpdated = replace(queueUpdated, 'stockSource.withoutBoxQuantity - reservedQuantity <\n                            Math.max(1, order.itemCount)',
  'stockSource.withoutBoxQuantity - reservedQuantity <\n                            sourceQuantity');
runtime = runtime.replace(queueBlock, queueUpdated);
for (const name of ['scanFbsTsdCode', 'scanFbsTsdBox', 'scanFbsTsdBarcode', 'completeFbsTsdAssembly']) {
  const start = runtime.indexOf('    async ' + name + '(');
  const end = runtime.indexOf('\n    }', start);
  if (start < 0 || end < 0) throw Error(name);
  const action = { scanFbsTsdCode: 'code', scanFbsTsdBox: 'box', scanFbsTsdBarcode: 'barcode', completeFbsTsdAssembly: 'complete' }[name];
  const block = runtime.slice(start, end);
  const needle = '        await this.requireFbsOrderStillCollectable(task);';
  const changed = replace(block, needle, needle + `\n        const multiline = await (0, ozon_fbs_pick_workflow_1.handleOzonPickLines)(this, task, user, '${action}'${action === 'complete' ? '' : ', payload'});\n        if (multiline) return multiline;`);
  runtime = runtime.slice(0, start) + changed + runtime.slice(end);
}
runtime = replace(runtime, '    async formatFbsTsdAssembly(task, user, message) {',
  "    async formatFbsTsdAssembly(task, user, message) {\n        const multiline = await (0, ozon_fbs_pick_workflow_1.handleOzonPickLines)(this, task, user, 'view', {}, message);\n        if (multiline) return multiline;");
const readMethod = fragment(source, '    async readOzonFbsPickPosting(', '    async submitOzonFbsTask(');
runtime = replace(runtime, '    async submitOzonFbsTask(task) {', readMethod + '    async submitOzonFbsTask(task) {');
const submit = fragment(runtime, '    async submitOzonFbsTask(', '    async submitOzonFbsMark(');
let checkedSubmit = replace(submit, '        (0, ozon_tsd_picking_1.requireOzonItemsScanned)(task);',
  '        const savedLines = (0, ozon_fbs_pick_lines_1.ozonPickLinesEnabled)() ? await (0, ozon_fbs_pick_lines_1.readOzonPickState)(this.prisma, task.id) : null;\n        if (savedLines && savedLines.lines.some(line => line.picks.length !== line.quantity)) throw new common_1.BadRequestException("Не все товарные строки Ozon отсканированы.");\n        if (!savedLines) (0, ozon_tsd_picking_1.requireOzonItemsScanned)(task);');
let newSubmit = replace(checkedSubmit, '            const status = textValue(posting.status).toLowerCase();',
  '            const lineState = (0, ozon_fbs_pick_lines_1.ozonPickLinesEnabled)() ? await (0, ozon_fbs_pick_lines_1.readOzonPickState)(this.prisma, task.id) : null;\n            if (lineState) (0, ozon_fbs_pick_lines_1.requireOzonLineComposition)(lineState, posting);\n            const status = textValue(posting.status).toLowerCase();');
newSubmit = replace(newSubmit, 'if (products.length !== 1 || totalQuantity !== Math.max(1, task.itemCount))',
  'if (!lineState && (products.length !== 1 || totalQuantity !== Math.max(1, task.itemCount)))');
runtime = runtime.replace(submit, newSubmit);
const sync = fragment(runtime, '    async syncOneFbsRequest(', '\n    async ');
let newSync = replace(sync, '        return this.prisma.$transaction(async (tx) => {',
  '        return this.prisma.$transaction(async (tx) => {\n            if ((0, ozon_fbs_pick_lines_1.ozonPickLinesEnabled)()) await tx.$queryRaw`SELECT id FROM "ClientRequest" WHERE id=${requestId} FOR UPDATE`;');
const compiledSync = fragment(source, '    async syncOneFbsRequest(', '\n    async ');
const stateMap = fragment(compiledSync, '            const ozonLineStates', '            const desiredItems');
newSync = replace(newSync, '            const desiredItems = new Map();', stateMap + '            const desiredItems = new Map();');
const lineBranch = fragment(compiledSync, '                // FIX: never collapse durable Ozon', "                if (link.syncStatus === FBS_REQUEST_LINK_MOVING");
const taskLine = '                const task = taskByKey.get(selectionKey(link.connectionId, link.orderId));';
newSync = replace(newSync, taskLine, taskLine + '\n' + lineBranch);
newSync = replace(newSync, '                for (const task of tasks) {', '                for (const task of tasks) {\n                    if (ozonLineStates.has(task.id)) continue;');
runtime = runtime.replace(sync, newSync);
// Include the independently tested notification change in the same candidate.
runtime = runtime.replace(fragment(runtime, '    async notifyFbsAutoStatusChanges(', '    async formatFbsTsdAssembly('),
  fragment(source, '    async notifyFbsAutoStatusChanges(', '    async formatFbsTsdAssembly('));
fs.writeFileSync(file, runtime);

const statusPath = 'common/stock/fbs-request-auto-status';
const statusFile = path.join(target, statusPath + '.js');
let status = fs.readFileSync(statusFile, 'utf8');
const compiledStatus = compile(statusPath);
status = replace(status, '"use strict";', '"use strict";\nconst ozon_fbs_pick_lines_1 = require("../../modules/marketplace-connections/ozon-fbs-pick-lines");');
status = status.replace(fragment(status, '    const byItem = new Map();', "    if (complete && trigger.stage !== 'START')"),
  fragment(compiledStatus, '    const byItem = new Map();', "    if (complete && trigger.stage !== 'START')"));
fs.writeFileSync(statusFile, status);
const factsPath = 'modules/tsd/tsd-assembly.service';
const factsFile = path.join(target, factsPath + '.js');
let facts = fs.readFileSync(factsFile, 'utf8');
const compiledFacts = compile(factsPath);
facts = replace(facts, '"use strict";', '"use strict";\nconst ozon_fbs_pick_lines_1 = require("../marketplace-connections/ozon-fbs-pick-lines");');
const states = fragment(compiledFacts, '        // FIX: keep the online per-item', '        const facts = rows.map');
facts = replace(facts, '        const facts = rows.map', states + '        const facts = rows.map');
const factBlock = fragment(facts, '        const facts = rows.map', '        const terminalLinks');
let updatedFactBlock = replace(factBlock, 'productName: row.productName,',
  'productName: ozonLineStates.get(row.id)?.lines.map(line => line.name).join("; ") ?? row.productName,');
updatedFactBlock = replace(updatedFactBlock, 'article: row.article,',
  'article: ozonLineStates.get(row.id)?.lines.map(line => `${line.article} × ${line.quantity}`).join("; ") ?? row.article,');
facts = facts.replace(factBlock, updatedFactBlock);
for (const [begin, end] of [
  ['        const pendingLinksBySku =', '        const notCollectedRows ='],
  ['            const eligibleOrderIds =', '            const sourceAllocations ='],
]) {
  facts = facts.replace(fragment(facts, begin, end), fragment(compiledFacts, begin, end));
}
fs.writeFileSync(factsFile, facts);
for (const name of ['ozon-fbs-pick-lines', 'ozon-fbs-pick-workflow']) {
  fs.writeFileSync(path.join(target, 'modules/marketplace-connections', name + '.js'), compile('modules/marketplace-connections/' + name));
}
console.log('Patched marketplace service, automatic request status, online facts and two new Ozon modules.');
