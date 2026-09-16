import type {FbsTsdAssembly} from '@prisma/client';

// FIX: one-off owner-approved adjacent sizes; never apply to another request/client.
const SOURCES: Record<string, string> = {
  '5752506052':'ac7d161f-a671-4efa-955b-d1a68d287bc4',
  '5750183862':'634fc084-7c68-4ce4-9200-66fddea8f998',
  '5754547558':'29406c68-e777-4b0a-8b23-7fb1e3f08680',
  '5758705261':'cc18b95e-d484-4907-ae15-b41e0903789e',
  '5736042769':'6da81820-1e09-40da-af66-a0cefd82bbec',
  '5736541572':'6da81820-1e09-40da-af66-a0cefd82bbec',
  '5735950705':'e670bac0-9f11-4a52-a2f0-f054014e4408',
  '5747467991':'29c9382e-e0e1-4126-82b4-65a06740fabc',
  '5748148372':'1c51b57e-0cfa-4ac8-b743-cdce889893f2',
  '5750334558':'3573e71a-99ec-4a6c-8e21-4199684e3a03',
  '5766660899':'099365c2-6565-4fc6-ad07-fc5f76891381',
  '5734625956':'6da81820-1e09-40da-af66-a0cefd82bbec',
  '5749086616':'9c01f559-6ea5-49d2-8ade-d56306cefa26',
};

export function retainDovoz1049Route(task: FbsTsdAssembly | undefined): boolean {
  return Boolean(task && task.clientId === 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' &&
    task.requestId === '16086a76-475c-463c-9dfd-430addda504b' &&
    task.connectionId === '3f022635-2efb-4b56-85ab-dfd48d9c24a8' && task.marketplace === 'WILDBERRIES' &&
    task.sourceSkuId && SOURCES[task.orderId] === task.sourceSkuId && task.relabelRequired &&
    !task.relabelConfirmedAt && !task.completedAt && !task.kiz &&
    ['RESERVED','WAITING_STOCK'].includes(task.status));
}
