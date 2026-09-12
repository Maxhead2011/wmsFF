// FIX: a fixed-origin, fixed-operation bridge; this is not a general browser proxy.
export const WMS_ORIGIN = 'https://wms.logoff.pro';
export function validSender(sender, extensionId) {
  try { return sender.id === extensionId && sender.frameId === 0 && Number.isInteger(sender.tab?.id) &&
    new URL(sender.url).origin === WMS_ORIGIN; } catch { return false; }
}
export function planKey(plan) {
  if (!plan || typeof plan.runId !== 'string' || !/^[a-f0-9-]{36}$/.test(plan.runId) ||
      !/^WB-GI-[1-9]\d*$/.test(plan.sourceSupplyId) || !/^WB-GI-[1-9]\d*$/.test(plan.targetSupplyId) ||
      plan.sourceSupplyId === plan.targetSupplyId || typeof plan.targetSupplyName !== 'string' ||
      !plan.targetSupplyName.length || plan.targetSupplyName.length > 128 || !Array.isArray(plan.orderIds) ||
      !plan.orderIds.length || plan.orderIds.length > 100 || new Set(plan.orderIds).size !== plan.orderIds.length ||
      plan.orderIds.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) throw new Error('Некорректная команда ВМС.');
  return JSON.stringify([plan.runId, plan.sourceSupplyId, plan.targetSupplyId, plan.targetSupplyName, [...plan.orderIds].sort()]);
}
export function validCommand(command) {
  planKey(command);
  return typeof command.commandId === 'string' && /^[a-f0-9-]{36}$/.test(command.commandId) &&
    Number.isFinite(Date.parse(command.expiresAt)) && Date.parse(command.expiresAt) > Date.now() && Date.parse(command.expiresAt) <= Date.now() + 125_000;
}
