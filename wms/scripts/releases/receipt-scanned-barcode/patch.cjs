// FIX: exact runtime overlay; do not replace the divergent production API with a full build.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const target = process.argv[2];
if (!target) throw Error('Pass captured API dist directory');
const file = path.join(target, 'modules/warehouse/receipt-channels.controller.js');
let code = fs.readFileSync(file, 'utf8');
const before = "barcode: r.sku.barcodes[0]?.value ?? ''";
const marker = 'const workbook = new exceljs_1.default.Workbook(), sheet = workbook.addWorksheet(';
if (code.split(before).length !== 2 || code.split(marker).length !== 2) throw Error('Receipt exporter changed; review current runtime');
const originalHash = crypto.createHash('sha256').update(code).digest('hex');
if (originalHash !== '94bfa977cff7bbc39f8854e6ca65cb55d58d1be3de903ab4e37edee515dd165b') throw Error('Unknown receipt controller preimage');
code = code.replace(marker, "const receiptBarcodes = await require('./receipt-export-barcode').receiptExportBarcodes(this.prisma, rows, boxes);\n        " + marker)
  .replace(before, "barcode: receiptBarcodes.get(r.id) ?? ''");
const source = fs.readFileSync(path.join(root, 'apps/api/src/modules/warehouse/receipt-export-barcode.ts'), 'utf8');
const helper = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
fs.writeFileSync(path.join(target, 'modules/warehouse/receipt-export-barcode.js'), helper);
fs.writeFileSync(file, code);
console.log(JSON.stringify({originalHash, files:['modules/warehouse/receipt-channels.controller.js','modules/warehouse/receipt-export-barcode.js']}));
