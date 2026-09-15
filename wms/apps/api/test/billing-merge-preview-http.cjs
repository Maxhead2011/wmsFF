// TEST: real Nest routing/validation and real HTTP header limit, with no database or financial writes.
// Run after API build: node --test test/billing-merge-preview-http.cjs
require('reflect-metadata');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const { BillingController } = require('../dist/modules/billing/billing.controller');
const { BillingService } = require('../dist/modules/billing/billing.service');
const { BillingDocumentService } = require('../dist/modules/billing/billing-document.service');
const { BillingPdfService } = require('../dist/modules/billing/billing-pdf.service');
const { BillingPeriodService } = require('../dist/modules/billing/billing-period.service');
const { PermissionsGuard } = require('../dist/modules/auth/guards/permissions.guard');
const invoiceIds = Array.from({ length: 771 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const calls = [];
let app, base;
before(async () => {
  class TestModule {}
  Module({ controllers: [BillingController], providers: [
    { provide: BillingService, useValue: { getFbsMergePreview: (clientId, user, ids) => {
      calls.push({ clientId, user, ids }); return { invoiceCount: ids?.length ?? 0 };
    } } },
    ...[BillingDocumentService, BillingPdfService, BillingPeriodService].map(provide => ({ provide, useValue: {} })),
  ] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
  app.useBodyParser('json', { limit: '10mb' });
  app.use((req, _res, next) => {
    req.user = { id: 'test-reader', permissionCodes: req.headers['x-test-read'] ? ['billing:read'] : [], activeWarehouseId: 'moscow' };
    next();
  });
  app.useGlobalGuards(new PermissionsGuard(new Reflector()));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1/billing/invoices/fbs-merge-preview`;
});
after(async () => { if (app) await app.close(); });
const post = (body, allowed = true) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(allowed ? { 'x-test-read': 'yes' } : {}) }, body: JSON.stringify(body) });
test('771 IDs exceed header limit on GET but reach the same preview intact through POST', async () => {
  const old = await fetch(`${base}?clientId=client&invoiceIds=${invoiceIds.join(',')}`, { headers: { 'x-test-read': 'yes' } });
  assert.equal(old.status, 431);
  const response = await post({ clientId: 'client', invoiceIds });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { invoiceCount: 771 });
  assert.deepEqual(calls.at(-1), { clientId: 'client', user: { id: 'test-reader', permissionCodes: ['billing:read'], activeWarehouseId: 'moscow' }, ids: invoiceIds });
});
test('legacy short GET still works', async () => {
  const response = await fetch(`${base}?clientId=client&invoiceIds=${invoiceIds[0]}`, { headers: { 'x-test-read': 'yes' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { invoiceCount: 1 });
});
test('POST retains billing read permission and never reaches the service when forbidden', async () => {
  const count = calls.length;
  assert.equal((await post({ clientId: 'client', invoiceIds }, false)).status, 403);
  assert.equal(calls.length, count);
});
test('invalid/empty/duplicate selections cannot silently become all invoices', async () => {
  const count = calls.length;
  for (const body of [{ invoiceIds }, { clientId: '' }, { clientId: 'client', invoiceIds: [] },
    { clientId: 'client', invoiceIds: ['bad'] }, { clientId: 'client', invoiceIds: [invoiceIds[0], invoiceIds[0]] },
    { clientId: 'client', invoiceIds: null }, { clientId: 'client', warehouseId: 'other' }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 120));
  }
  assert.equal(calls.length, count);
});
