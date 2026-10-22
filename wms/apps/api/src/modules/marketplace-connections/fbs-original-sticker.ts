import { BadRequestException, ForbiddenException } from '@nestjs/common';
export type OriginalRepeatSticker = { partA: string; partB: string; barcode: string; imageBase64: string };
export function assertOriginalStickerEnabled() {
  if (process.env.WMS_FBS_ORIGINAL_STICKER_ENABLED !== 'true') throw new ForbiddenException('Повторная сборка со старым стикером не включена.');
}
// FIX: never accept a newly issued/different sticker as the original one.
export function assertOriginalStickerIdentity(task: {stickerPartA?:string|null;stickerPartB?:string|null;stickerBarcode?:string|null}, label:OriginalRepeatSticker) {
  if (!task.stickerPartA || !task.stickerPartB || !task.stickerBarcode || label.partA!==task.stickerPartA || label.partB!==task.stickerPartB || label.barcode!==task.stickerBarcode || !label.imageBase64 || !Buffer.from(label.imageBase64,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new BadRequestException('Прежний стикер не подтверждён или отличается от полученного WB. Повторная заявка не создана.');
  }
}
// FIX: the ordinary WB cache/API must never replace the pinned original label.
export function pinnedOriginalSticker(task:{marketplace:string;marketplaceLabelBase64?:string|null;marketplaceLabelContentType?:string|null;stickerPartA?:string|null;stickerPartB?:string|null;stickerBarcode?:string|null}) {
  if(task.marketplace!=='WILDBERRIES'||task.marketplaceLabelContentType!=='image/png; purpose=original-repeat')return null;
  assertOriginalStickerEnabled();
  const label={partA:task.stickerPartA||'',partB:task.stickerPartB||'',barcode:task.stickerBarcode||'',imageBase64:task.marketplaceLabelBase64||''};
  assertOriginalStickerIdentity(task,label);
  return {marketplace:'WILDBERRIES' as const,...label,contentType:'image/png'};
}
