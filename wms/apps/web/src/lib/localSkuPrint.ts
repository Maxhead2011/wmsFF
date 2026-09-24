export type LocalSkuPrintImage = { imageBase64: string; copies: number };

// FIX: use the browser's printer dialog for a locally installed printer, without creating a WMS queue job.
export function buildLocalSkuPrintHtml(images: LocalSkuPrintImage[], widthMm = 60, heightMm = 40) {
  if (![widthMm, heightMm].every(value => Number.isInteger(value) && value >= 20 && value <= 150) || !images.length || images.some(image => !/^[A-Za-z0-9+/]+={0,2}$/.test(image.imageBase64) || !Number.isInteger(image.copies) || image.copies < 1)) {
    throw new Error('Не удалось подготовить этикетки для локальной печати.');
  }
  const pages = images.flatMap(image => Array.from({ length: image.copies }, () =>
    `<div class="label-page"><img src="data:image/png;base64,${image.imageBase64}" alt="Этикетка товара"></div>`)).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ШК товара · ${widthMm} × ${heightMm} мм</title><style>
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .label-page { width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; break-after: page; page-break-after: always; }
    .label-page:last-child { break-after: auto; page-break-after: auto; }
    .label-page img { display: block; width: ${widthMm}mm; height: ${heightMm}mm; }
    .print-toolbar { display: none; }
    @media screen { body { background: #eef2f6; } .print-toolbar { display: flex; position: sticky; top: 0; z-index: 1; align-items: center; justify-content: center; gap: 12px; padding: 12px; background: #fff; box-shadow: 0 1px 8px #0002; font: 14px Arial,sans-serif; } .print-toolbar button { padding: 9px 18px; border: 0; border-radius: 8px; background: #d71920; color: #fff; font: 700 14px Arial,sans-serif; cursor: pointer; } .label-page { background: white; margin: 12px auto; box-shadow: 0 1px 8px #0002; } }
  </style></head><body><div class="print-toolbar"><button id="local-print-action" type="button">Напечатать</button><span>Выберите принтер, масштаб 100% и поля «Нет».</span></div>${pages}</body></html>`;
}

export function openLocalSkuPrint(images: LocalSkuPrintImage[], widthMm = 60, heightMm = 40, openedWindow?: Window | null) {
  const html = buildLocalSkuPrintHtml(images, widthMm, heightMm);
  const printWindow = openedWindow ?? window.open('', '_blank');
  if (!printWindow) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна для WMS.');
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  // FIX: about:blank can finish loading before document.write, so a new load event is not guaranteed.
  const showDialog = () => { printWindow.focus(); printWindow.print(); };
  printWindow.document.getElementById('local-print-action')?.addEventListener('click', showDialog);
  void Promise.all(Array.from(printWindow.document.images).map(image => image.decode().catch(() => undefined)))
    .then(() => setTimeout(() => { try { showDialog(); } catch { /* The visible print button remains available. */ } }, 100));
}
