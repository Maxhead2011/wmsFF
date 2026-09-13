type LabelImage = { contentType: string; imageBase64: string };
type PrintLabels = LabelImage & { orderId: string; sortingLabel: LabelImage & { widthMm: number; heightMm: number } };
const image = (value: LabelImage | undefined) => {
  if (!value || value.contentType !== 'image/png' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64)) {
    throw new Error('Не получена этикетка WB или сортировочная наклейка. Обновите WMS.');
  }
  return `<img src="data:image/png;base64,${value.imageBase64}">`;
};
// FIX: no local sorting template; both images are the same bytes as the station receives.
export function orderAssemblyPrintHtml(result: PrintLabels) {
  const wb = image(result), sorting = image(result.sortingLabel);
  return `<html><head><title>Печать WB</title><style>
    @page{size:58mm 40mm;margin:0}*{box-sizing:border-box}html,body{margin:0}
    .label{width:58mm;height:40mm;break-after:page;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .label:last-of-type{break-after:auto}.label img{width:58mm;height:40mm;object-fit:contain}
    </style></head><body><section class="label">${wb}</section><section class="label">${sorting}</section>
    <script>window.onload=()=>setTimeout(()=>{print();close()},180)</script></body></html>`;
}
