// TEST: real PostgreSQL billing races, isolated synthetic database only. Run after API build/db push.
// NODE_ENV=test DATABASE_URL=postgresql://...@billing-qa-postgres-20260910/billing_qa_20260910 node test/billing-period-postgres.cjs
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(process.env.NODE_ENV, 'test', 'Only NODE_ENV=test is allowed');
assert.equal(url.protocol, 'postgresql:', 'Only the isolated PostgreSQL fixture is allowed');
assert.equal(url.hostname, 'billing-qa-postgres-20260910', 'Refusing a non-QA database host');
assert.equal(url.pathname, '/billing_qa_20260910', 'Refusing a non-QA database name');

const { PrismaClient } = require('@prisma/client');
const { BillingService } = require('../dist/modules/billing/billing.service');
const { BillingPeriodService } = require('../dist/modules/billing/billing-period.service');
const { ClientScopeService } = require('../dist/modules/auth/client-scope.service');
const LOCK_CLASS = 1464685395;
const LOCK_OBJECT = 1179209294;
const scopes = new ClientScopeService();
function connection(name) {
  const address = new URL(url);
  address.searchParams.set('application_name', name);
  address.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasources: { db: { url: address.toString() } } });
}
const db = connection('billing-qa-observer');
const control = connection('billing-qa-barrier');
const writers = [connection('billing-qa-writer-1'), connection('billing-qa-writer-2')];
const billing = writers.map(writer => new BillingService(writer, scopes));
const period = writers.map((writer, index) => new BillingPeriodService(writer, scopes, billing[index]));
const month = { periodFrom: '2026-08-01', periodTo: '2026-08-31' };
const results = [];
let fixtureSequence = 0;
let actor;
let warehouses;
let fbsService;

function admin(warehouse = warehouses[0]) {
  return {
    id: actor.id, email: actor.email, name: actor.name, isDemo: false,
    roleCodes: ['ADMIN'], permissionCodes: ['system:admin', 'billing:write'],
    clientScopeMode: 'ALL', clientIds: [], writableClientIds: [],
    activeWarehouseId: warehouse.id, warehouseIds: warehouses.map(row => row.id),
    writableWarehouseIds: warehouses.map(row => row.id), hiddenClientIds: [],
  };
}
async function fixture(warehouse = warehouses[0], quantity = 1) {
  const key = `BILLING_QA_${++fixtureSequence}`;
  const client = await db.client.create({ data: { code: key, name: `Synthetic ${key}` } });
  const request = await db.clientRequest.create({ data: {
    clientId: client.id, warehouseId: warehouse.id, type: 'SERVICE', title: key, createdByUserId: actor.id,
  } });
  const charge = await db.billingCharge.create({ data: {
    clientId: client.id, requestId: request.id, serviceId: fbsService.id,
    description: `Synthetic FBS ${key}`, unit: 'PIECE', quantity, unitPriceRub: 100,
    totalRub: quantity * 100, status: 'APPROVED', serviceDate: new Date('2026-08-31T00:00:00Z'),
    createdByUserId: actor.id, approvedByUserId: actor.id,
    metadata: { kind: 'FBS', warehouseId: warehouse.id },
  } });
  return { client, request, charge, warehouse, user: admin(warehouse) };
}
const legacyDto = item => ({ ...month, clientId: item.client.id, chargeIds: [item.charge.id] });
const previewDto = item => ({ ...month, clientId: item.client.id, categories: ['FBS'], excludeLukin: true });
async function generateDto(item, index = 0) {
  const dto = previewDto(item);
  const preview = await period[index].previewPeriod(dto, item.user);
  assert.equal(preview.groups.length, 1, 'Fixture should have exactly one billable group');
  return { ...dto, previewHash: preview.previewHash };
}
function watch(operation) {
  const state = { settled: false };
  state.promise = Promise.resolve().then(operation).then(
    value => { state.settled = true; return { status: 'fulfilled', value }; },
    reason => { state.settled = true; return { status: 'rejected', reason }; },
  );
  return state;
}
async function waitForQueuedWriter(index, task) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw`
      SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.classid = ${LOCK_CLASS}::oid
        AND l.objid = ${LOCK_OBJECT}::oid AND l.objsubid = 2
        AND NOT l.granted AND a.datname = current_database()
        AND a.application_name = ${`billing-qa-writer-${index + 1}`}`;
    if (rows.length === 1) return;
    assert.equal(task.settled, false, `Writer ${index + 1} completed without waiting for the financial lock (RED)`);
    // Polling inspects an actual PostgreSQL waiter; elapsed time does not decide execution order.
    await delay(20);
  }
  throw new Error(`Writer ${index + 1} did not enter the shared financial lock within 8 seconds`);
}
async function race(first, second) {
  let release;
  let locked;
  const acquired = new Promise(resolve => { locked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const holder = control.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${LOCK_CLASS}::int, ${LOCK_OBJECT}::int)`;
    locked();
    await gate;
  }, { timeout: 25000, maxWait: 5000 });
  const tasks = [];
  try {
    await Promise.race([acquired, holder.then(() => { throw new Error('Barrier closed before acquisition'); })]);
    tasks.push(watch(first));
    await waitForQueuedWriter(0, tasks[0]);
    tasks.push(watch(second));
    await waitForQueuedWriter(1, tasks[1]);
    release();
    await holder;
    return await Promise.all(tasks.map(task => task.promise));
  } finally {
    release();
    await holder.catch(() => undefined);
    await Promise.all(tasks.map(task => task.promise));
  }
}
const success = outcome => {
  assert.equal(outcome.status, 'fulfilled', outcome.reason?.message);
  return outcome.value;
};
function rejected(outcome) {
  assert.equal(outcome.status, 'rejected', 'A conflicting financial mutation must be rejected');
  assert.ok([400, 403, 409].includes(outcome.reason?.getStatus?.()), 'Expected a domain rejection, not SQL/runtime failure');
}
async function oneActiveCharge(chargeId) {
  const rows = await db.billingInvoiceItem.findMany({
    where: { chargeId, invoice: { status: { not: 'CANCELLED' } } },
    include: { invoice: true },
  });
  assert.equal(rows.length, 1, 'A charge must appear in exactly one active invoice');
  return rows[0].invoice;
}
async function test(name, operation) {
  await operation();
  results.push(name);
  console.log(JSON.stringify({ test: name, result: 'PASS' }));
}

async function main() {
  assert.equal(await db.client.count(), 0, 'Fresh synthetic database required; never reuse real or populated data');
  assert.equal(await db.billingInvoice.count(), 0, 'Fresh invoice table required');
  assert.equal(await db.billingCharge.count(), 0, 'Fresh charge table required');
  assert.equal(await db.user.count(), 0, 'Fresh synthetic users required');
  warehouses = await Promise.all(['A', 'B'].map(key => db.warehouse.create({ data: { code: `BILLING_QA_${key}`, name: `Synthetic branch ${key}` } })));
  actor = await db.user.create({ data: { email: 'billing-qa@example.invalid', name: 'Synthetic billing admin', passwordHash: 'NOT_A_LOGIN_HASH' } });
  fbsService = await db.billingService.create({ data: { code: 'FBS_PROCESSING', name: 'Synthetic FBS service', unit: 'PIECE', defaultPriceRub: 100 } });

  // TEST: every period/legacy race enters the same DB lock, not just an in-process mutex.
  for (const periodFirst of [true, false]) {
    await test(`legacy createInvoice vs period generation; period first=${periodFirst}`, async () => {
      const item = await fixture();
      const dto = await generateDto(item);
      const outcomes = await race(
        () => periodFirst ? period[0].generatePeriod(dto, item.user) : billing[0].createInvoice(legacyDto(item), item.user),
        () => periodFirst ? billing[1].createInvoice(legacyDto(item), item.user) : period[1].generatePeriod(dto, item.user),
      );
      success(outcomes[0]);
      rejected(outcomes[1]);
      const invoice = await oneActiveCharge(item.charge.id);
      assert.equal(Number(invoice.totalRub), 100);
      assert.equal(invoice.periodTo.toISOString(), '2026-08-31T23:59:59.999Z', 'Historical UTC calendar dates stay in August');
    });
  }
  // TEST: successful replay does not create another invoice; current permissions are rechecked.
  await test('period replay is idempotent and checks current client access', async () => {
    const item = await fixture();
    const dto = await generateDto(item);
    const created = await period[0].generatePeriod(dto, item.user);
    const replay = await period[1].generatePeriod(dto, item.user);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.invoices, created.invoices);
    await oneActiveCharge(item.charge.id);
    const revoked = { ...item.user, permissionCodes: ['billing:write'], roleCodes: ['MANAGER'], clientScopeMode: 'LIMITED', clientIds: [item.client.id], writableClientIds: [] };
    await assert.rejects(() => period[1].generatePeriod(dto, revoked), error => error.getStatus?.() === 403);
    assert.equal(await db.auditLog.count({ where: { action: 'billing.period.generate', userId: actor.id, payload: { path: ['clientId'], equals: item.client.id } } }), 1);
  });
  // TEST: two separately connected workers must preserve both legitimate partial payments.
  for (const amounts of [[40, 60], [60, 60]]) {
    await test(`parallel payments ${amounts.join('+')} on a 100 invoice`, async () => {
      const item = await fixture();
      const invoice = await billing[0].createInvoice(legacyDto(item), item.user);
      const outcomes = await race(
        () => billing[0].createPayment({ invoiceId: invoice.id, amountRub: amounts[0] }, item.user),
        () => billing[1].createPayment({ invoiceId: invoice.id, amountRub: amounts[1] }, item.user),
      );
      success(outcomes[0]);
      if (amounts[0] + amounts[1] <= 100) success(outcomes[1]); else rejected(outcomes[1]);
      const current = await db.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
      const expected = amounts[0] + amounts[1] <= 100 ? 100 : 60;
      assert.equal(Number(current.paidRub), expected, 'No lost paidRub update');
      assert.equal(current.payments.reduce((sum, payment) => sum + Number(payment.amountRub), 0), expected);
      assert.equal(current.payments.length, expected === 100 ? 2 : 1);
      assert.equal(current.status, expected === 100 ? 'PAID' : 'ISSUED');
    });
  }
  // TEST: a merge cannot cancel a paid source; payment cannot revive a merged source.
  for (const mergeFirst of [true, false]) {
    await test(`merge vs payment; merge first=${mergeFirst}`, async () => {
      const item = await fixture();
      const firstInvoice = await billing[0].createInvoice(legacyDto(item), item.user);
      const secondCharge = await db.billingCharge.create({ data: {
        clientId: item.client.id, requestId: item.request.id, serviceId: fbsService.id,
        description: 'Synthetic second FBS charge', quantity: 1, unitPriceRub: 100, totalRub: 100,
        status: 'APPROVED', serviceDate: new Date('2026-08-10T00:00:00Z'), metadata: { kind: 'FBS', warehouseId: item.warehouse.id },
      } });
      const secondInvoice = await billing[0].createInvoice({ ...legacyDto(item), chargeIds: [secondCharge.id] }, item.user);
      const merge = { invoiceIds: [firstInvoice.id, secondInvoice.id], aggregateSameItems: true };
      const payment = { invoiceId: firstInvoice.id, amountRub: 25 };
      const outcomes = await race(
        () => mergeFirst ? billing[0].mergeInvoices(merge, item.user) : billing[0].createPayment(payment, item.user),
        () => mergeFirst ? billing[1].createPayment(payment, item.user) : billing[1].mergeInvoices(merge, item.user),
      );
      success(outcomes[0]);
      rejected(outcomes[1]);
      const source = await db.billingInvoice.findUniqueOrThrow({ where: { id: firstInvoice.id }, include: { payments: true } });
      assert.equal(source.status, mergeFirst ? 'CANCELLED' : 'ISSUED');
      assert.equal(Number(source.paidRub), mergeFirst ? 0 : 25);
      assert.equal(source.payments.length, mergeFirst ? 0 : 1);
      await oneActiveCharge(item.charge.id);
      await oneActiveCharge(secondCharge.id);
    });
  }
  // TEST: numbering is global, so independent branches must also serialize number allocation.
  await test('two branches allocate distinct invoice numbers concurrently', async () => {
    const left = await fixture(warehouses[0]);
    const right = await fixture(warehouses[1]);
    const outcomes = await race(
      () => billing[0].createInvoice(legacyDto(left), left.user),
      () => billing[1].createInvoice(legacyDto(right), right.user),
    );
    const a = success(outcomes[0]), b = success(outcomes[1]);
    assert.notEqual(a.number, b.number);
    assert.equal(a.warehouseId, warehouses[0].id);
    assert.equal(b.warehouseId, warehouses[1].id);
    await oneActiveCharge(left.charge.id);
    await oneActiveCharge(right.charge.id);
    await assert.rejects(() => billing[0].createPayment({ invoiceId: b.id, amountRub: 10 }, left.user), error => error.getStatus?.() === 403 || error.getStatus?.() === 400);
    assert.equal(await db.billingPayment.count({ where: { invoiceId: b.id } }), 0, 'Cross-branch payment must not write anything');
  });
  // TEST: storage receives its branch from real source rows, then remains usable by period billing.
  await test('single-branch historical and snapshot storage generate period invoices', async () => {
    for (const historical of [true, false]) {
      const key = `BILLING_STORAGE_QA_${++fixtureSequence}`;
      const client = await db.client.create({ data: { code: key, name: key, storageAccountingEnabled: true, storagePriceRubPerLiterDay: 2 } });
      const sku = await db.sku.create({ data: { clientId: client.id, internalSku: key, name: key, volumeLiters: 1.5 } });
      if (historical) {
        await db.stockMovement.create({ data: { clientId: client.id, skuId: sku.id, warehouseId: warehouses[0].id,
          type: 'RECEIPT', status: 'AVAILABLE', quantity: 2, createdAt: new Date('2026-07-31T00:00:00Z') } });
      } else {
        await db.stockBalance.create({ data: { balanceKey: key, clientId: client.id, skuId: sku.id,
          warehouseId: warehouses[0].id, status: 'AVAILABLE', quantity: 2 } });
      }
      const user = admin();
      const charge = await billing[0].generateStorageCharge({ ...month, clientId: client.id, approve: true }, user);
      assert.equal(charge.status, 'APPROVED');
      assert.equal(charge.requestId, null);
      assert.equal(charge.metadata.warehouseId, warehouses[0].id, 'Source proof, not selected-branch guessing');
      assert.equal(Number(charge.quantity), 93, 'Existing formula: 2 units × 1.5 litres × 31 days');
      assert.equal(Number(charge.totalRub), 186, 'Existing tariff and storage formula unchanged');
      const dto = { ...month, clientId: client.id, categories: ['STORAGE'], excludeLukin: true };
      const preview = await period[0].previewPeriod(dto, user);
      assert.equal(preview.groups.length, 1);
      assert.equal(preview.issues.length, 0);
      assert.equal(preview.groups[0].category, 'STORAGE');
      assert.equal(preview.groups[0].totalRub, 186);
      const generated = await period[1].generatePeriod({ ...dto, previewHash: preview.previewHash }, user);
      assert.equal(generated.invoices.length, 1);
      const invoice = await oneActiveCharge(charge.id);
      assert.equal(invoice.warehouseId, warehouses[0].id);
      assert.equal(Number(invoice.totalRub), 186);
    }
  });
  // TEST: an administrator's active branch cannot silently absorb another branch or unknown stock.
  await test('mixed or unknown storage source branches fail without financial writes', async () => {
    for (const historical of [true, false]) {
      for (const otherWarehouseId of [warehouses[1].id, null]) {
        const key = `BILLING_STORAGE_BLOCK_QA_${++fixtureSequence}`;
        const client = await db.client.create({ data: { code: key, name: key, storageAccountingEnabled: true, storagePriceRubPerLiterDay: 2 } });
        const sku = await db.sku.create({ data: { clientId: client.id, internalSku: key, name: key, volumeLiters: 1.5 } });
        for (const [index, warehouseId] of [warehouses[0].id, otherWarehouseId].entries()) {
          if (historical) {
            await db.stockMovement.create({ data: { clientId: client.id, skuId: sku.id, warehouseId,
              type: 'RECEIPT', status: 'AVAILABLE', quantity: 2, createdAt: new Date('2026-07-31T00:00:00Z') } });
          } else {
            await db.stockBalance.create({ data: { balanceKey: `${key}_${index}`, clientId: client.id, skuId: sku.id,
              warehouseId, status: 'AVAILABLE', quantity: 2 } });
          }
        }
        await assert.rejects(() => billing[0].generateStorageCharge({ ...month, clientId: client.id, approve: true }, admin()),
          error => error.getStatus?.() === 400 && /филиал/i.test(error.message));
        assert.equal(await db.billingCharge.count({ where: { clientId: client.id } }), 0);
        assert.equal(await db.billingInvoice.count({ where: { clientId: client.id } }), 0);
        assert.equal(await db.billingPayment.count({ where: { clientId: client.id } }), 0);
      }
    }
  });
  console.log(JSON.stringify({ result: 'PASS', count: results.length, tests: results, database: 'billing_qa_20260910', externalCalls: 0 }));
}

const watchdog = setTimeout(() => {
  console.error('Billing PostgreSQL harness exceeded 150 seconds; disposable QA container must be stopped.');
  process.exit(1);
}, 150000);
main().catch(error => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}).finally(async () => {
  // No deletion: root may inspect fixtures on failure and remove the explicitly named QA container.
  await Promise.allSettled([db, control, ...writers].map(client => client.$disconnect()));
  clearTimeout(watchdog);
});
