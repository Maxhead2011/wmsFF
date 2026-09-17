import { portalOperation } from './portal.js';
import { planKey, validCommand, validSender } from './protocol.js';
// FIX: serial handling prevents two WMS tabs from passing the same durable intent check.
let queue = Promise.resolve();
async function invoke(tabId, plan, execute) {
  const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func: portalOperation, args: [plan, execute] });
  const result = results[0];
  if (!result?.result) throw new Error('Кабинет WB не подтвердил запрос. Откройте нужного продавца и поставку FBS, затем повторите сверку в ВМС.');
  if (result.result.error) throw new Error(result.result.error);
  return result.result;
}
async function handle(message, sender) {
  if (!validSender(sender, chrome.runtime.id)) throw new Error('Источник команды не разрешён.');
  if (message?.kind === 'PING') return { version: chrome.runtime.getManifest().version };
  if (message?.kind === 'PREPARE') {
    const key = planKey(message.plan);
    const tabs = await chrome.tabs.query({ url: 'https://seller.wildberries.ru/*' });
    if (!tabs.length) throw new Error('Откройте кабинет WB в этом браузере и выберите нужного продавца.');
    const supplyTabs = tabs.filter(tab => new URL(tab.url).searchParams.get('supplyID') === message.plan.sourceSupplyId);
    const candidates = supplyTabs.length ? supplyTabs : tabs;
    if (candidates.length > 3) throw new Error('Откройте исходную поставку в одной вкладке WB или закройте лишние вкладки кабинета.');
    const matching = []; let lastError;
    for (const tab of candidates) {
      try { if ((await invoke(tab.id, message.plan, false)).ready) matching.push(tab.id); } catch (error) { lastError = error; }
    }
    if (!matching.length && candidates.length === 1 && lastError) throw lastError;
    if (matching.length !== 1) throw new Error(matching.length ? 'Оставьте одну вкладку кабинета WB с нужным продавцом.' :
      'Не найден подходящий кабинет WB. Откройте нужного продавца в разделе поставок FBS. Если WB обновился, обновите расширение.');
    const ticket = crypto.randomUUID();
    await chrome.storage.session.set({ [ticket]: { key, wmsTabId: sender.tab.id, documentId: sender.documentId,
      wbTabId: matching[0], expiresAt: Date.now() + 90_000 } });
    return { ticket };
  }
  if (message?.kind === 'EXECUTE') {
    if (!validCommand(message.command) || typeof message.ticket !== 'string') throw new Error('Команда истекла. Выполните сверку в ВМС.');
    const proof = (await chrome.storage.session.get(message.ticket))[message.ticket];
    if (!proof || proof.key !== planKey(message.command) || proof.wmsTabId !== sender.tab.id ||
        proof.documentId !== sender.documentId || proof.expiresAt < Date.now()) throw new Error('Подтверждение кабинета истекло. Выполните сверку в ВМС.');
    const key = `attempt:${message.command.runId}`;
    if ((await chrome.storage.local.get(key))[key]) throw new Error('Команда уже отправлялась. Выполните сверку в ВМС; повторный перенос заблокирован.');
    // Persist before browser-side mutation, including across worker/browser restarts.
    await chrome.storage.local.set({ [key]: { commandId: message.command.commandId, startedAt: Date.now() } });
    await chrome.storage.session.remove(message.ticket);
    return invoke(proof.wbTabId, message.command, true);
  }
  throw new Error('Неизвестная команда расширения.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  queue = queue.then(() => handle(message, sender)).then(result => respond({ ok: true, result }),
    error => respond({ ok: false, error: error instanceof Error ? error.message : 'Ошибка расширения WB.' }));
  return true;
});
