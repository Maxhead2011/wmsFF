type Ribbon = { fileBase64: string; pageCount: number; warnings: string[] };
type Station = { id: string; name: string; printerName: string; labelWidthMm: number; labelHeightMm: number };

async function api(token: string, path: string, body?: unknown) {
  const response = await fetch(`/api/v1/print/series/${path}`, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Не удалось обратиться к агенту печати.');
  return data;
}

// FIX: keep a durable operation ID after an ambiguous response; retry cannot enqueue twice.
export async function sendWbRibbon(token: string, clientId: string, stationId: string, fileBase64: string) {
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([clientId, stationId, fileBase64]))));
  const key = `wms-wb-ribbon:${Array.from(fingerprint, n => n.toString(16).padStart(2, '0')).join('')}`;
  const requestId = sessionStorage.getItem(key) || crypto.randomUUID();
  sessionStorage.setItem(key, requestId);
  const result = await api(token, 'pdf-jobs', { requestId, clientId, stationId, fileBase64 });
  sessionStorage.removeItem(key);
  if (result.status === 'failed' || result.status === 'cancelled') throw new Error('Задание завершилось с ошибкой или отменено. Проверьте очередь перед повторной печатью.');
  return result;
}

// FIX: native top-layer dialog, one printer-bound station and one whole-ribbon job.
export async function openWbRibbonPrint(token: string, clientId: string, ribbon: Ribbon, marketplace: 'WB' | 'Ozon' = 'WB') {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Печать всех ШК ' + marketplace);
  dialog.style.cssText = 'border:1px solid #d6e2e7;border-radius:20px;padding:24px;width:min(560px,90vw);max-height:85vh;overflow:auto;color:#263b49;background:white;font:16px/1.5 system-ui,sans-serif;box-shadow:0 18px 65px #0004';
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string) => {
    const element = document.createElement(tag); element.textContent = text; dialog.append(element); return element;
  };
  add('h2', 'Печать всех ШК ' + marketplace);
  add('p', `${ribbon.pageCount} стр. · ${marketplace === 'Ozon' ? 'ШК товара + этикетка отправления Ozon' : 'СЦ → ПВЗ → ШК товара + QR заказа'} · 58 × 40 мм`);
  if (ribbon.warnings.length) { const warning = add('p', `Неполный комплект: ${ribbon.warnings.join(' ')}`); warning.setAttribute('role', 'alert'); warning.style.color = '#925400'; }
  const label = add('label', 'Станция и принтер');
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Станция и принтер'); label.append(select);
  select.style.cssText = 'display:block;width:100%;margin:10px 0 18px;padding:12px;border:1px solid #cddde3;border-radius:10px';
  const status = add('p', 'Загружаю доступные принтеры…'); status.setAttribute('role', 'status');
  const print = add('button', 'Печатать'), close = add('button', 'Отмена');
  for (const button of [print, close]) { button.type = 'button'; button.style.cssText = 'padding:12px 20px;margin:8px 8px 0 0;border:1px solid #d6c9ed;border-radius:12px;font:inherit;font-weight:600;cursor:pointer;background:#f0eaf7;color:#364354'; }
  print.disabled = true;
  let busy = false, disposed = false;
  const cleanup = () => { disposed = true; dialog.remove(); };
  close.onclick = () => { if (!busy) { dialog.close(); cleanup(); } };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', cleanup, { once: true });
  document.body.append(dialog); dialog.showModal();
  print.onclick = async () => {
    if (busy || !select.value) return;
    busy = true; print.disabled = true; select.disabled = true; close.disabled = true;
    status.textContent = 'Отправляю всю ленту одним заданием…';
    try {
      const job = await sendWbRibbon(token, clientId, select.value, ribbon.fileBase64);
      status.textContent = `Лента передана агенту: ${job.pages} стр. Статус: ${job.status === 'printed' ? 'напечатано' : 'в очереди / отправлено на принтер'}.`;
      close.textContent = 'Закрыть'; print.hidden = true;
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Не удалось подтвердить отправку.'; print.textContent = 'Повторить отправку'; print.disabled = false; select.disabled = false; }
    finally { busy = false; close.disabled = false; }
  };
  try {
    const [ready, formats]: [Station[], Station[]] = await Promise.all([api(token, 'stations'), api(token, 'formats')]);
    if (disposed) return;
    const available = formats.filter(s => s.labelWidthMm === 58 && s.labelHeightMm === 40 && ready.some(r => r.id === s.id));
    for (const station of available) { const option = document.createElement('option'); option.value = station.id; option.textContent = `${station.name} — ${station.printerName}`; select.append(option); }
    status.textContent = available.length ? 'Выберите принтер и нажмите «Печатать».' : 'Нет доступного агента с этикетками 58 × 40 мм. Запустите агент или скачайте PDF.';
    print.disabled = !available.length;
  } catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : 'Не удалось загрузить принтеры.'; }
}
