// FIX: self-contained function runs only inside the WB tab. No authentication data leaves it.
export async function portalOperation(plan, execute = false) {
  try {
  const fail = message => { const error = new Error(message); error.bridgeSafe = true; throw error; };
  if (location.origin !== 'https://seller.wildberries.ru') fail('Откройте кабинет WB.');
  if (!plan || !/^WB-GI-[1-9]\d*$/.test(plan.sourceSupplyId) || !/^WB-GI-[1-9]\d*$/.test(plan.targetSupplyId) ||
      plan.sourceSupplyId === plan.targetSupplyId || typeof plan.targetSupplyName !== 'string' ||
      !plan.targetSupplyName || plan.targetSupplyName.length > 128 || !Array.isArray(plan.orderIds) ||
      !plan.orderIds.length || plan.orderIds.length > 100 || new Set(plan.orderIds).size !== plan.orderIds.length ||
      plan.orderIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) fail('Некорректная команда переноса.');
  const validTime = () => !execute || (typeof plan.commandId === 'string' && /^[a-f0-9-]{36}$/.test(plan.commandId) &&
    Number.isFinite(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) > Date.now() && Date.parse(plan.expiresAt) <= Date.now() + 125_000);
  if (!validTime()) fail('Команда истекла. Откройте сверку операции в ВМС.');
  // Reviewed portal build: root-monorepo v1.113.3, FBS v1.7.14. Fail closed on a changed runtime.
  if (![...document.scripts].some(script => /^https:\/\/static-basket-02\.wbbasket\.ru\/vol20\/root-monorepo\/(latest|v1\.113\.3)\/main\.1b45f8149289a03d\.js$/.test(script.src))) {
    fail('WB обновил кабинет. Требуется обновление расширения LOGOFF; перенос не отправлен.');
  }
  const chunks = window.webpackChunk;
  if (!Array.isArray(chunks)) fail('Кабинет WB ещё загружается. Откройте раздел поставок FBS.');
  let SDK;
  chunks.push([[`logoff-read-sdk-${crypto.randomUUID()}`], {}, require => { SDK = require(35443); }]);
  if (typeof SDK?.RestRequest !== 'function') fail('Клиент запросов WB недоступен.');
  // Supplier cookie is only compared inside this tab; never returned, logged, or sent to WMS.
  const account = () => document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('x-supplier-id=')) || '';
  const selected = account();
  if (!selected) fail('Войдите в кабинет WB и выберите продавца.');
  const base = 'https://marketplace.wildberries.ru/ns/marketplace-app/marketplace-remote-wh/api/v3/portal/supplies';
  const request = async (method, suffix, body) => {
    if (account() !== selected) fail('Кабинет WB изменился. Перенос остановлен.');
    const client = new SDK.RestRequest();
    if (typeof client.getIsomorphicFetch !== 'function') fail('Изменился клиент WB. Требуется обновление расширения.');
    const factory = client.getIsomorphicFetch.bind(client); let sent = false;
    // Fence the actual fetch too: portal MFA/response interceptors cannot replay a mutation.
    client.getIsomorphicFetch = options => {
      if (options.endpoint !== `${base}${suffix}`) fail('WB изменил адрес запроса. Перенос остановлен.');
      const transport = factory(options);
      if (typeof transport.requestFetch !== 'function') fail('Изменился транспорт WB.');
      return { ...transport, requestFetch: () => {
        if (account() !== selected || (method === 'PATCH' && (!validTime() || sent))) fail('Повторная или устаревшая команда WB заблокирована. Выполните сверку в ВМС.');
        sent = true; return transport.requestFetch();
      } };
    };
    const result = await client[method === 'PATCH' ? 'patchRequest' : 'getRequest']({ endpoint: `${base}${suffix}`,
      ...(body ? { body } : {}), credentials: 'include', cache: 'no-store', cacheIsDisabled: true,
      retry: 0, middlewaresAreDisabled: true, customTimeout: 25_000, redirect: 'error', tracingDisabled: true });
    if (result?.error || client.statusCode < 200 || client.statusCode >= 300) {
      // Raw portal error payloads can contain session details: expose only HTTP status.
      fail(`Кабинет WB вернул HTTP ${Number(client.statusCode) || 0}. Проверьте выбранного продавца и сверку операции в ВМС.`);
    }
    return result?.data;
  };
  const source = await request('GET', `/${plan.sourceSupplyId}`);
  const target = await request('GET', `/${plan.targetSupplyId}`);
  // Both globally unique supply IDs must be readable in the selected seller account.
  if (source?.supplyID !== plan.sourceSupplyId || target?.supplyID !== plan.targetSupplyId ||
      target.name !== plan.targetSupplyName || target.ordersCnt !== 0 || !Number.isInteger(source.ordersCnt) || source.ordersCnt < plan.orderIds.length) {
    fail('Выбран другой кабинет WB или состав поставок изменился. Проверьте продавца и выполните сверку в ВМС.');
  }
  if (account() !== selected) fail('Кабинет WB изменился. Перенос остановлен.');
  if (!execute) return { ready: true };
  const result = await request('PATCH', `/${plan.sourceSupplyId}/orders/transfer`, { orderIds: plan.orderIds.map(Number), newSupply: plan.targetSupplyId });
  if (!Array.isArray(result?.transferredOrders) || result.transferredOrders.length !== plan.orderIds.length ||
      new Set(result.transferredOrders.map(row => row.orderId)).size !== plan.orderIds.length ||
      result.transferredOrders.some(row => !plan.orderIds.includes(String(row.orderId)) || !Number.isSafeInteger(row.newStickerId) ||
        !Number.isSafeInteger(row.oldStickerId) || row.newStickerId <= 0 || row.oldStickerId <= 0 || row.oldStickerId === row.newStickerId)) {
    fail('WB не подтвердил полный результат переноса. Выполните сверку в ВМС.');
  }
  // Completion and sticker identifiers are independently read by the server via the API key.
  return { transferred: true };
  } catch (error) { return { error: error?.bridgeSafe ? error.message : 'Не удалось выполнить запрос кабинета WB. Откройте сверку операции в ВМС.' }; }
}
