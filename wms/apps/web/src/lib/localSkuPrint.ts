export type LocalSkuPrintImage = { imageBase64: string; copies: number };

// FIX: use the browser's printer dialog for a locally installed printer, without creating a WMS queue job.
export function buildLocalSkuPrintHtml(images: LocalSkuPrintImage[]) {
  if (!images.length || images.some(image => !/^[A-Za-z0-9+/]+={0,2}$/.test(image.imageBase64) || !Number.isInteger(image.copies) || image.copies < 1)) {
    throw new Error('Не удалось подготовить этикетки для локальной печати.');
  }
  const pages = images.flatMap(image => Array.from({ length: image.copies }, () =>
    `<div class="label-page"><img src="data:image/png;base64,${image.imageBase64}" alt="Этикетка товара"></div>`)).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ШК товара · 40 × 60 мм</title><style>
    @page { size: 40mm 60mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .label-page { width: 40mm; height: 60mm; overflow: hidden; break-after: page; page-break-after: always; }
    .label-page:last-child { break-after: auto; page-break-after: auto; }
    .label-page img { display: block; width: 40mm; height: 60mm; }
    @media screen { body { background: #eef2f6; } .label-page { background: white; margin: 12px auto; box-shadow: 0 1px 8px #0002; } }
  </style></head><body>${pages}</body></html>`;
}

export function openLocalSkuPrint(images: LocalSkuPrintImage[]) {
  const html = buildLocalSkuPrintHtml(images);
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна для WMS.');
  printWindow.addEventListener('load', () => {
    void Promise.all(Array.from(printWindow.document.images).map(image => image.decode().catch(() => undefined)))
      .then(() => printWindow.print());
  }, { once: true });
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}
