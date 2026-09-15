// TEST: isolated browser regression; all API calls are intercepted, no real requests are created.
// Run with PLAYWRIGHT_MODULE and optionally BROWSER_PATH / XLSX_FIXTURE / TEST_OUTPUT_DIR.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = path.resolve(__dirname, '..');
const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve(web + '/node_modules/vite'))] }));
const out = process.env.TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'wms-xlsx-test-'));
fs.mkdirSync(out, { recursive: true });
const harness = `import React from 'react';import{createRoot}from'react-dom/client';
import{ClientRequestXlsxImportForm}from'./src/components/client-requests/ClientRequestXlsxImportForm';
const session={accessToken:'test-only',user:{id:'client-user',activeWarehouseId:null,roleCodes:['CLIENT'],permissionCodes:['client-requests:write'],clientScopeMode:'LIMITED',clientIds:['client'],writableClientIds:['client']}};
createRoot(document.getElementById('root')).render(<ClientRequestXlsxImportForm session={session} clients={[{id:'client',code:'CL',name:'ИП Лукин Илья Ильич'}]} onCreated={r=>window.created=r}/>);`;
esbuild.buildSync({ stdin: { contents: harness, resolveDir: web, sourcefile: 'xlsx-test.tsx', loader: 'tsx' }, bundle: true, format: 'esm', outfile: out + '/app.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' } });
const html = '<html lang="ru"><meta charset="utf-8"><style>body{font:16px system-ui}label{display:block;margin:12px}input,select,button{padding:8px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>';
(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? fs.readFileSync(out + '/app.js') : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage(); const errors = []; const previews = []; const creates = []; const uploads = [];
    page.on('pageerror', e => errors.push(e.message));
    let rejectPreview = true;
    await page.route('**/api/v1/**', async route => {
      const req = route.request(); const url = new URL(req.url());
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (url.pathname === '/api/v1/branches') return reply([{ id: 'msk', city: 'Москва', name: 'ФФ Москва' }, { id: 'ng', city: 'Ногинск', name: 'Ногинск' }]);
      if (url.pathname.endsWith('/outbound-xlsx/preview')) {
        const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData();
        previews.push({ warehouseId: form.get('warehouseId'), fileName: form.get('file').name, bytes: Buffer.from(await form.get('file').arrayBuffer()), date: form.get('desiredDate') });
        if (rejectPreview) { rejectPreview = false; return reply({ message: 'Повторите проверку файла.' }, 503); }
        return reply({ title: 'Поставка', canCommit: true, issues: [], relabelSourceOptions: [], summary: {}, lines: [{ skuId: 'sku', internalSku: 'SKU', name: 'Товар', barcode: '2047945587614', requestedQuantity: 7, availableQuantity: 7, stockQuantity: 7, reservedQuantity: 0, shortageQuantity: 0, canFulfill: true, sourceRows: [2], conflicts: [], actionSuggestions: [] }] });
      }
      if (url.pathname === '/api/v1/client-requests') { creates.push(req.postDataJSON()); return reply({ id: 'created', title: 'Поставка', files: [] }); }
      if (url.pathname === '/api/v1/client-requests/created/files') { uploads.push(req.postDataBuffer()); return reply({ id: 'source', fileName: 'template (5).xlsx' }); }
      throw Error('Unexpected request: ' + url.pathname);
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    const branch = page.getByRole('combobox', { name: /^Филиал исполнения для Excel/ });
    await page.waitForFunction(() => document.querySelector('select')?.value === 'msk');
    await page.getByLabel('Город поставки', { exact: true }).fill('Москва');
    await page.getByLabel('Желаемая дата', { exact: true }).fill('2026-09-18');
    const bytes = process.env.XLSX_FIXTURE ? fs.readFileSync(process.env.XLSX_FIXTURE) : Buffer.from('test-workbook');
    await page.getByLabel('Файл Excel', { exact: true }).setInputFiles({ name: 'template (5).xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
    const check = page.getByRole('button', { name: 'Проверить файл', exact: true });
    await check.click(); await page.getByText('Повторите проверку файла.', { exact: true }).waitFor();
    await page.getByText('Выбран файл: template (5).xlsx', { exact: true }).waitFor();
    await check.click(); await page.getByText('Файл готов к созданию заявки.', { exact: true }).waitFor();
    const create = page.getByRole('button', { name: 'Создать заявку', exact: true }); assert(await create.isEnabled());
    await branch.selectOption('ng'); assert(await create.isDisabled());
    await page.getByText('Выбран файл: template (5).xlsx', { exact: true }).waitFor();
    await check.click(); await page.getByText('Файл готов к созданию заявки.', { exact: true }).waitFor();
    // Clearing the native picker simulates a browser reporting no selection after cancellation.
    await page.getByLabel('Файл Excel', { exact: true }).setInputFiles([]);
    assert(await create.isEnabled()); await page.screenshot({ path: out + '/excel-form.png', fullPage: true });
    await create.click(); await page.waitForFunction(() => Boolean(window.created));
    assert.equal(creates.length, 1); assert.equal(uploads.length, 1);
    assert.equal(creates[0].warehouseId, 'ng'); assert.equal(creates[0].desiredDate, '2026-09-18');
    assert.deepEqual(previews.map(p => p.warehouseId), ['msk', 'msk', 'ng']);
    assert(previews.every(p => p.fileName === 'template (5).xlsx' && p.bytes.equals(bytes) && p.date === '2026-09-18'));
    assert.deepEqual(errors, []);
    const result = { passed: true, checks: ['profile branch absent', 'file bytes and date retained after error', 'branch change invalidates preview', 'file picker cancellation retains file', 'creation and attachment once with selected branch'], realBusinessWrites: false };
    fs.writeFileSync(out + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
