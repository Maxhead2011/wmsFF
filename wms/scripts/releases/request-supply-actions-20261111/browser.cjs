const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const root = path.resolve(process.argv[2]);
const origin = process.env.TEST_ORIGIN;
const published = process.env.PUBLIC_MODE === 'true';
const user = {
  id: 'supply-release-check', name: 'Проверка выпуска', email: 'test@example.invalid',
  roleCodes: ['OWNER','ADMIN'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL',
  clientIds: [], writableClientIds: [], activeWarehouseId: 'moscow', warehouseIds: ['moscow'],
  writableWarehouseIds: ['moscow'], administrationEnabled: true,
};
const client = { id: 'client', code: 'CL-1', name: 'Проверка WB', marketplaceConnections: [{ marketplace: 'WILDBERRIES', isActive: true }] };
const request = {
  id: 'request-1', number: 99101, title: 'FBS — проверка WB', type: 'OUTBOUND', status: 'IN_WORK',
  priority: 'NORMAL', createdAt: '2026-11-11T08:00:00Z', updatedAt: '2026-11-11T08:00:00Z',
  client, clientId: client.id, warehouseId: 'moscow', items: [], files: [], packages: [],
  wbSupplyIds: ['WB-GI-TEST'], fbsCompletion: { totalOrders: 2, completedOrders: 2, percent: 100, completed: true },
};
const orders = ['1', '2'].map(id => ({
  id, marketplace: 'WILDBERRIES', connectionId: 'cabinet', supplyId: 'WB-GI-TEST', request,
  category: 'active', supplierStatus: 'confirm', wbStatus: 'waiting', statusLabel: 'На сборке',
  itemCount: 1, barcodes: ['123'], storageBoxes: [], requiredMeta: [], optionalMeta: [],
  product: { id: 'sku', name: 'Товар', barcodes: ['123'] }, createdAt: request.createdAt,
}));
const snapshot = {
  client, connected: true, connections: [{ id: 'cabinet', marketplace: 'WILDBERRIES', accountName: 'Тест WB' }],
  deliveryPlan: { destination: 'PICKUP_POINT', itemsPerCargoPlace: 1, requiresCargoPlaces: true },
  orders, counts: { all: 2, active: 2, shipped: 0, archive: 0, cancelled: 0 }, fetchedAt: request.createdAt,
};
const delivery = {
  shippingPointsEnabled: true, blockers: [], defaultPlannedDeliveryDate: '2026-11-12',
  requiredDestinationOfficeId: 'office', offices: [{ id: 'office', name: 'Склад WB', compatible: true }],
  supplies: [{ connectionId: 'cabinet', supplyId: 'WB-GI-TEST', orderCount: 2, itemCount: 2, destinationOfficeId: 'office', cargoPlaceIds: [] }],
};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
    page.setDefaultTimeout(14000);
    const errors = [], calls = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
    await page.addInitScript(u => {
      localStorage.setItem('logoff-wms-session', JSON.stringify({ accessToken: 'synthetic', user: u }));
      localStorage.setItem('logoff-wms-ui-theme:' + u.id, 'modern');
    }, user);
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), p = url.pathname;
      if (p.startsWith('/api/')) {
        let body = []; if(process.env.DEBUG_BROWSER)console.log(req.method(),p,url.search);
        if (p.endsWith('/auth/me')) body = user;
        else if (p.endsWith('/branches')) body = [{ id: 'moscow', name: 'ФФ Москва', isActive: true }];
        else if (p.endsWith('/clients')) body = [client];
        else if (p.endsWith('/box-overlaps')) body = { statusCounts: [], overlaps: [], errors: [], overlappingBoxesCount: 0 };
        else if (p.endsWith('/client-requests')) body = [request, { ...request, id: 'unready', number: 99102, title: 'FBS — не собрана', fbsCompletion: { totalOrders: 2, completedOrders: 1, percent: 50, completed: false } }];
        else if (p.endsWith('/fbs/orders')) body = snapshot;
        else if (p.endsWith('/fbs/active-clients')) body = [{ client, activeOrders: 2 }];
        else if (p.endsWith('/delivery-options') || p.endsWith('/all-labels')) {
          calls.push({ path: p, payload: req.postDataJSON() });
          body = p.endsWith('/delivery-options') ? delivery : {
            fileBase64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'), fileName: 'wb-test.pdf', pageCount: 1, warnings: [],
          };
        } else if (p.includes('shipping-points')) body = { points: [], shippingPoints: [] };
        return route.fulfill({ json: body });
      }
      if (!published && url.origin === origin) {
        const file = path.join(root, 'web-payload', p === '/' ? 'index.html' : p);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html' });
        }
      }
      return route.continue();
    });
    const openRequests = async () => {
      await page.getByText('Заявки', { exact: true }).first().click();
      await page.locator('tr').filter({ hasText: 'FBS — проверка WB' }).waitFor().catch(async e=>{console.log((await page.locator('body').innerText()).slice(-4500));throw e;});
      return page.locator('tr').filter({ hasText: 'FBS — проверка WB' });
    };
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByText('Быстрый доступ', { exact: true }).waitFor();
    let row = await openRequests();
    assert(await page.locator('tr').filter({ hasText: 'FBS — не собрана' }).getByRole('button', { name: 'Передать на МП' }).isDisabled());
    await row.getByRole('button', { name: 'Передать на МП' }).click();
    const dialog = page.getByRole('dialog', { name: 'Пункт сдачи и грузоместа WB' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('input[type="date"]').first().inputValue(), '2026-11-12');
    await page.screenshot({ path: path.join(root, published ? 'published-dialog.png' : 'candidate-dialog.png') });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    row = await openRequests();
    await row.getByText('Стикеры поставки', { exact: true }).click();
    const download = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Скачать все ШК', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'wb-test.pdf');
    row = await openRequests();
    const labels = row.getByText('Стикеры поставки', { exact: true });
    if (!(await labels.evaluate(el => el.parentElement.open))) await labels.click();
    await row.getByRole('button', { name: 'Распечатать все ШК', exact: true }).click();
    await page.getByRole('dialog', { name: 'Печать всех ШК WB' }).waitFor();
    assert.equal(calls.length, 3);
    for (const { payload } of calls) assert.deepEqual(payload, {
      clientId: client.id, orders: orders.map(({ id, connectionId }) => ({ id, connectionId })),
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, published ? 'published-browser-proof.json' : 'browser-proof.json'), JSON.stringify({
      transferDialog: true, unassembledDisabled: true, download: true, printDialog: true, exactOrders: true,
    }));
    console.log('PASS: transfer, disabled incomplete request, PDF download, print dialog, exact order scope');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
