// FIX: retain the explicit shortage label used by the consolidated FBS display.
export function fbsRequestSyncTitle(title: string, quantity: number, reshipment: boolean, repeat: boolean, shortageEnabled: boolean) {
  if (reshipment || (shortageEnabled && title.trim().toLocaleLowerCase('ru-RU') === 'logoff нет на складе')) return title;
  return repeat ? `Повторная сборка WB — ${quantity} заказов` : `FBS — ${quantity} заказ(а/ов)`;
}
