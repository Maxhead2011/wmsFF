const { PrismaClient, MarketplaceType } = require('@prisma/client');

const prisma = new PrismaClient();
const scanned = String(process.env.KIZ || '').replace(/^\]d2/i, '').trim();

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function main() {
  if (scanned.length < 6) throw new Error('KIZ is required');
  const mark = await prisma.productMark.findFirst({
    where: { value: { contains: scanned, mode: 'insensitive' } },
    select: { clientId: true, skuId: true },
  });
  if (!mark) {
    console.log(JSON.stringify({ markFound: false, matches: [] }, null, 2));
    return;
  }
  const tasks = await prisma.fbsTsdAssembly.findMany({
    where: {
      clientId: mark.clientId,
      marketplace: MarketplaceType.WILDBERRIES,
      OR: [{ skuId: mark.skuId }, { sourceSkuId: mark.skuId }],
    },
    select: { orderId: true, connectionId: true, requestId: true, status: true, kiz: true },
  });
  const requests = await prisma.clientRequest.findMany({
    where: { id: { in: [...new Set(tasks.map((task) => task.requestId))] } },
    select: { id: true, number: true },
  });
  const requestNumberById = new Map(requests.map((request) => [request.id, request.number]));
  const connections = await prisma.clientMarketplaceConnection.findMany({
    where: { id: { in: [...new Set(tasks.map((task) => task.connectionId))] } },
    select: { id: true, apiKey: true },
  });
  const matches = [];
  for (const connection of connections) {
    const connectionTasks = tasks.filter((task) => task.connectionId === connection.id);
    for (const batch of chunks(connectionTasks, 100)) {
      const response = await fetch('https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta', {
        method: 'POST',
        headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ orders: batch.map((task) => Number(task.orderId)) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`WB HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      const payload = await response.json();
      for (const task of batch) {
        const remote = Array.isArray(payload.orders)
          ? payload.orders.find((item) => Number(item?.id) === Number(task.orderId))
          : null;
        const values = Array.isArray(remote?.meta?.sgtin?.value) ? remote.meta.sgtin.value : [];
        if (values.some((value) => String(value).toLowerCase().includes(scanned.toLowerCase()))) {
          matches.push({
            orderId: task.orderId,
            requestNumber: requestNumberById.get(task.requestId) || null,
            status: task.status,
            localKiz: task.kiz,
            remoteKiz: values,
          });
        }
      }
    }
  }
  console.log(JSON.stringify({ markFound: true, taskCandidates: tasks.length, matches }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
