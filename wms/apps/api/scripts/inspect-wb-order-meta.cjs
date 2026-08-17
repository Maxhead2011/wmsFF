const { PrismaClient, MarketplaceType } = require('@prisma/client');

const prisma = new PrismaClient();
const orderIds = String(process.env.ORDER_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

async function main() {
  const tasks = await prisma.fbsTsdAssembly.findMany({
    where: { orderId: { in: orderIds }, marketplace: MarketplaceType.WILDBERRIES },
    select: {
      orderId: true,
      connectionId: true,
      requestId: true,
      kiz: true,
      status: true,
      wbMetaStatus: true,
    },
  });
  const connections = await prisma.clientMarketplaceConnection.findMany({
    where: { id: { in: [...new Set(tasks.map((task) => task.connectionId))] } },
    select: { id: true, apiKey: true },
  });
  const result = [];
  for (const connection of connections) {
    const connectionTasks = tasks.filter((task) => task.connectionId === connection.id);
    const response = await fetch(
      'https://marketplace-api.wildberries.ru/api/marketplace/v3/orders/meta',
      {
        method: 'POST',
        headers: {
          Authorization: connection.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ orders: connectionTasks.map((task) => Number(task.orderId)) }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new Error(`WB HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    const statusResponse = await fetch(
      'https://marketplace-api.wildberries.ru/api/v3/orders/status',
      {
        method: 'POST',
        headers: {
          Authorization: connection.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ orders: connectionTasks.map((task) => Number(task.orderId)) }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!statusResponse.ok) throw new Error(`WB status HTTP ${statusResponse.status}: ${(await statusResponse.text()).slice(0, 500)}`);
    const statusPayload = await statusResponse.json();
    for (const task of connectionTasks) {
      const remote = Array.isArray(payload.orders)
        ? payload.orders.find((item) => Number(item?.id) === Number(task.orderId))
        : null;
      const remoteStatus = Array.isArray(statusPayload.orders)
        ? statusPayload.orders.find((item) => Number(item?.id) === Number(task.orderId))
        : null;
      result.push({
        orderId: task.orderId,
        requestId: task.requestId,
        status: task.status,
        wbMetaStatus: task.wbMetaStatus,
        localKiz: task.kiz,
        remoteKiz: Array.isArray(remote?.meta?.sgtin?.value) ? remote.meta.sgtin.value : [],
        supplierStatus: remoteStatus?.supplierStatus || null,
        wbStatus: remoteStatus?.wbStatus || null,
      });
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
