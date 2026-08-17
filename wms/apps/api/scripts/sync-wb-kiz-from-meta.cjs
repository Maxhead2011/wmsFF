const { PrismaClient, MarketplaceType } = require('@prisma/client');

const prisma = new PrismaClient();
const requestNumbers = String(process.env.REQUEST_NUMBERS || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
const batchSize = 100;

function normalizedKiz(value) {
  return String(value || '').replace(/<GS>/gi, '\u001d').replace(/^\]d2/i, '').trim();
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function remoteSgtins(payload, orderId) {
  const order = Array.isArray(payload?.orders)
    ? payload.orders.find((candidate) => Number(candidate?.id) === Number(orderId))
    : null;
  const values = order?.meta?.sgtin?.value;
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizedKiz)
    .filter(Boolean))];
}

async function wbMetadata(apiKey, orderIds) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(
      'https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta',
      {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ orders: orderIds.map(Number) }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.ok) return response.json();
    const body = await response.text();
    lastError = new Error(`WB HTTP ${response.status}: ${body.slice(0, 500)}`);
    if (response.status !== 429 && response.status < 500) throw lastError;
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1_000
      : Math.min(30_000, 1_500 * (2 ** attempt));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw lastError;
}

async function main() {
  if (requestNumbers.length === 0) {
    throw new Error('REQUEST_NUMBERS is required, for example 220,221,222');
  }

  const requests = await prisma.clientRequest.findMany({
    where: { number: { in: requestNumbers } },
    select: { id: true, number: true, clientId: true },
  });
  const foundNumbers = new Set(requests.map((request) => request.number));
  const missingRequests = requestNumbers.filter((number) => !foundNumbers.has(number));
  if (missingRequests.length > 0) {
    throw new Error(`WMS requests not found: ${missingRequests.join(', ')}`);
  }

  const tasks = await prisma.fbsTsdAssembly.findMany({
    where: {
      requestId: { in: requests.map((request) => request.id) },
      marketplace: MarketplaceType.WILDBERRIES,
      requiresKiz: true,
    },
    select: {
      id: true,
      clientId: true,
      connectionId: true,
      orderId: true,
      requestId: true,
      skuId: true,
      status: true,
      kiz: true,
      wbMetaStatus: true,
    },
    orderBy: [{ connectionId: 'asc' }, { orderId: 'asc' }],
  });
  const requestNumberById = new Map(requests.map((request) => [request.id, request.number]));
  const connectionIds = [...new Set(tasks.map((task) => task.connectionId))];
  const connections = await prisma.clientMarketplaceConnection.findMany({
    where: {
      id: { in: connectionIds },
      marketplace: MarketplaceType.WILDBERRIES,
      isActive: true,
    },
    select: { id: true, clientId: true, apiKey: true },
  });
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));

  const existingKizRows = await prisma.fbsTsdAssembly.findMany({
    where: {
      clientId: { in: [...new Set(tasks.map((task) => task.clientId))] },
      kiz: { not: null },
    },
    select: { id: true, clientId: true, orderId: true, kiz: true },
  });
  const existingByClientKiz = new Map();
  for (const row of existingKizRows) {
    existingByClientKiz.set(`${row.clientId}:${normalizedKiz(row.kiz).toLowerCase()}`, row);
  }

  const summary = {
    requestNumbers,
    apply,
    totalOrders: tasks.length,
    alreadyLocal: tasks.filter((task) => Boolean(task.kiz)).length,
    attached: 0,
    remoteMissing: 0,
    remoteMultiple: 0,
    duplicateConflict: 0,
    skuConflict: 0,
    connectionMissing: 0,
    unchangedRace: 0,
    failedBatches: 0,
    byRequest: Object.fromEntries(requestNumbers.map((number) => [number, {
      total: 0,
      alreadyLocal: 0,
      attached: 0,
      remoteMissing: 0,
      conflicts: 0,
    }])),
    conflicts: [],
  };
  for (const task of tasks) {
    const row = summary.byRequest[requestNumberById.get(task.requestId)];
    row.total += 1;
    if (task.kiz) row.alreadyLocal += 1;
  }

  for (const connectionId of connectionIds) {
    const connection = connectionById.get(connectionId);
    const connectionTasks = tasks.filter((task) => task.connectionId === connectionId);
    if (!connection) {
      summary.connectionMissing += connectionTasks.length;
      for (const task of connectionTasks) {
        const number = requestNumberById.get(task.requestId);
        summary.byRequest[number].conflicts += 1;
        summary.conflicts.push({ requestNumber: number, orderId: task.orderId, reason: 'CONNECTION_MISSING' });
      }
      continue;
    }

    for (const batch of chunks(connectionTasks, batchSize)) {
      let metadata;
      try {
        metadata = await wbMetadata(connection.apiKey, batch.map((task) => task.orderId));
      } catch (error) {
        summary.failedBatches += 1;
        for (const task of batch) {
          const number = requestNumberById.get(task.requestId);
          summary.byRequest[number].conflicts += 1;
          summary.conflicts.push({ requestNumber: number, orderId: task.orderId, reason: 'WB_FETCH_FAILED' });
        }
        console.error(error instanceof Error ? error.message : String(error));
        continue;
      }

      for (const task of batch) {
        if (task.kiz) continue;
        const number = requestNumberById.get(task.requestId);
        const remote = remoteSgtins(metadata, task.orderId);
        if (remote.length === 0) {
          summary.remoteMissing += 1;
          summary.byRequest[number].remoteMissing += 1;
          continue;
        }
        if (remote.length !== 1) {
          summary.remoteMultiple += 1;
          summary.byRequest[number].conflicts += 1;
          summary.conflicts.push({ requestNumber: number, orderId: task.orderId, reason: `REMOTE_KIZ_COUNT_${remote.length}` });
          continue;
        }

        const kiz = remote[0];
        const duplicate = existingByClientKiz.get(`${task.clientId}:${kiz.toLowerCase()}`);
        if (duplicate && duplicate.id !== task.id) {
          summary.duplicateConflict += 1;
          summary.byRequest[number].conflicts += 1;
          summary.conflicts.push({ requestNumber: number, orderId: task.orderId, reason: 'DUPLICATE_LOCAL_KIZ', conflictingOrderId: duplicate.orderId });
          continue;
        }

        const mark = await prisma.productMark.findFirst({
          where: { value: { equals: kiz, mode: 'insensitive' } },
          select: { clientId: true, skuId: true },
        });
        if (mark && (mark.clientId !== task.clientId || mark.skuId !== task.skuId)) {
          summary.skuConflict += 1;
          summary.byRequest[number].conflicts += 1;
          summary.conflicts.push({ requestNumber: number, orderId: task.orderId, reason: 'PRODUCT_MARK_SKU_CONFLICT' });
          continue;
        }

        if (apply) {
          const changed = await prisma.fbsTsdAssembly.updateMany({
            where: { id: task.id, kiz: null },
            data: { kiz, wbMetaStatus: 'ACCEPTED', errorMessage: null },
          });
          if (changed.count !== 1) {
            summary.unchangedRace += 1;
            continue;
          }
        }
        existingByClientKiz.set(`${task.clientId}:${kiz.toLowerCase()}`, {
          id: task.id,
          clientId: task.clientId,
          orderId: task.orderId,
          kiz,
        });
        summary.attached += 1;
        summary.byRequest[number].attached += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  if (apply) {
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: 'FBS_KIZ_IMPORTED_FROM_WB_METADATA',
        entity: 'ClientRequest',
        entityId: requests.map((request) => request.id).join(','),
        payload: {
          requestNumbers,
          totalOrders: summary.totalOrders,
          alreadyLocal: summary.alreadyLocal,
          attached: summary.attached,
          remoteMissing: summary.remoteMissing,
          remoteMultiple: summary.remoteMultiple,
          duplicateConflict: summary.duplicateConflict,
          skuConflict: summary.skuConflict,
          connectionMissing: summary.connectionMissing,
          failedBatches: summary.failedBatches,
          byRequest: summary.byRequest,
        },
      },
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
