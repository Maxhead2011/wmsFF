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

// FIX: owner-approved replacements are restricted to the exact orders of request 1099.
const SOURCES_1099: Record<string, string> = {
  "5723435480": "2be8eae1-bf1f-4111-b4c7-ba66c7870fc4",
  "5735386049": "2be8eae1-bf1f-4111-b4c7-ba66c7870fc4",
  "5738977395": "2be8eae1-bf1f-4111-b4c7-ba66c7870fc4",
  "5775532988": "099365c2-6565-4fc6-ad07-fc5f76891381",
  "5761202748": "099365c2-6565-4fc6-ad07-fc5f76891381",
  "5773172975": "099365c2-6565-4fc6-ad07-fc5f76891381",
  "5774549612": "099365c2-6565-4fc6-ad07-fc5f76891381",
  "5775060517": "099365c2-6565-4fc6-ad07-fc5f76891381",
  "5756354807": "ed4455c6-0380-40b6-bf91-de9c6113c30c",
  "5792105121": "285754e3-443a-41ef-8a91-c3c7490504de",
  "5771340009": "379d73ec-70cb-4475-a00e-c999e1bcf824",
  "5739497465": "192fb6cc-f5ef-45ec-b36c-31629a502bd5",
  "5737646525": "192fb6cc-f5ef-45ec-b36c-31629a502bd5",
  "5782430206": "53652e53-efd9-4c28-9730-f00a6f6aa0e1",
  "5786255090": "073c09e6-687e-41e3-bfce-6f2248b1d0fd",
  "5792640349": "073c09e6-687e-41e3-bfce-6f2248b1d0fd",
  "5795718882": "073c09e6-687e-41e3-bfce-6f2248b1d0fd",
  "5733964100": "5e4cc363-1980-4ae3-acc5-1d07ac608b74",
  "5733964101": "6c9857cc-cc0e-486e-abc8-bff1e25ea843",
  "5737481735": "00b8b914-f90b-4356-80e4-d83fac17066c",
  "5775964628": "b9047216-7959-445c-8b90-595aa64a5e0f",
  "5737523437": "3402780a-b7e5-49bc-adc4-4d79a47e692a",
  "5773707409": "26f01436-fb12-4caa-9695-38ac50cd4b27",
  "5778781711": "26f01436-fb12-4caa-9695-38ac50cd4b27",
  "5751658835": "29406c68-e777-4b0a-8b23-7fb1e3f08680"
};

export function retainDovoz1049Route(task: FbsTsdAssembly | undefined): boolean {
  return Boolean(task && task.clientId === 'c76b78f9-1b83-4e9b-bee3-bc28336ee1c9' &&
    task.connectionId === '3f022635-2efb-4b56-85ab-dfd48d9c24a8' && task.marketplace === 'WILDBERRIES' &&
    task.sourceSkuId && (
      (task.requestId === '16086a76-475c-463c-9dfd-430addda504b' && SOURCES[task.orderId] === task.sourceSkuId) ||
      (task.requestId === '22ca973f-e181-4bd9-9e32-0e463f3c5681' && SOURCES_1099[task.orderId] === task.sourceSkuId)
    ) && task.relabelRequired &&
    !task.relabelConfirmedAt && !task.completedAt && !task.kiz &&
    ['RESERVED','WAITING_STOCK'].includes(task.status));
}
