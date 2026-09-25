import { BadRequestException, ConflictException } from '@nestjs/common';

export type OzonPick = { barcode: string; boxId: string | null; boxCode: string; actorId: string; at: string };
export type OzonPickLine = {
  productId: number; offerId: string; quantity: number; skuId: string; requestItemId: string;
  name: string; article: string; barcodes: string[]; picks: OzonPick[];
};
export type OzonPickState = {
  version: 1; lines: OzonPickLine[];
  source: { boxId: string | null; boxCode: string } | null;
  submission: 'PICKING' | 'SUBMITTING' | 'UNKNOWN' | 'SUBMITTED' | 'COMPLETED';
  legacyScansDiscarded: boolean;
};
export const ozonPickLinesEnabled = () => process.env.WMS_OZON_MULTILINE_PICKING === 'true';
export const ozonPickCount = (state: OzonPickState) => state.lines.reduce((n, line) => n + line.picks.length, 0);
export const ozonPickTotal = (state: OzonPickState) => state.lines.reduce((n, line) => n + line.quantity, 0);
export const ozonActiveLine = (state: OzonPickState) => state.lines.find(line => line.picks.length < line.quantity);

// FIX: quantities and identities must be exact; an equal grand total is not proof of composition.
export function ozonPostingProducts(posting: any): { productId: number; offerId: string; quantity: number; barcodes: string[] }[] {
  if (!Array.isArray(posting?.products) || !posting.products.length) throw new BadRequestException('Ozon не вернул состав заказа.');
  const products: { productId: number; offerId: string; quantity: number; barcodes: string[] }[] = posting.products.map((product: any) => {
    const productId = Number(product.sku), quantity = Number(product.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !product.offer_id) {
      throw new BadRequestException('Некорректная товарная строка Ozon. Обновите заказ.');
    }
    return { productId, quantity, offerId: String(product.offer_id), barcodes: Array.isArray(product.barcodes) ? product.barcodes.map(String) : [] };
  });
  if (new Set(products.map(p => p.productId)).size !== products.length) throw new BadRequestException('Ozon вернул повторяющиеся строки товара. Нужна проверка состава.');
  return products;
}

export function requireOzonLineComposition(state: OzonPickState, posting: any) {
  const actual = ozonPostingProducts(posting);
  if (actual.length !== state.lines.length || state.lines.some(line => {
    const remote = actual.find(p => p.productId === line.productId && p.offerId === line.offerId);
    return !remote || remote.quantity !== line.quantity || line.picks.length !== line.quantity;
  })) throw new ConflictException('Состав Ozon изменился или не все товары отсканированы. Отправка остановлена; обновите заказ.');
  const marks = posting.requirements?.products_requiring_mandatory_mark;
  if (Array.isArray(marks) && marks.length) throw new BadRequestException('Ozon требует маркировку: для многотоварного заказа нужна отдельная проверка КИЗ.');
}

export function recordOzonLineScan(state: OzonPickState, barcode: string, expectedCount: unknown, actorId: string, now = new Date()): OzonPickState {
  const count = ozonPickCount(state);
  if (!Number.isSafeInteger(expectedCount) || Number(expectedCount) < 0 || Number(expectedCount) > count) {
    throw new ConflictException('Обновите задание: отсутствует актуальный счётчик сканирования.');
  }
  // FIX: replay of the previous request cannot consume a unit from the next product line.
  if (Number(expectedCount) < count) {
    const accepted = state.lines.flatMap(line => line.picks)[Number(expectedCount)];
    if (accepted?.barcode !== barcode) throw new ConflictException('Этот номер сканирования уже занят другим товаром. Обновите задание.');
    return state;
  }
  if (state.submission !== 'PICKING') throw new ConflictException('Заказ уже передаётся в Ozon. Новые сканы не принимаются.');
  const index = state.lines.findIndex(line => line.picks.length < line.quantity);
  if (index < 0) throw new BadRequestException('Все товары уже отсканированы. Подтвердите отбор.');
  const line = state.lines[index];
  if (!line.barcodes.includes(barcode)) throw new BadRequestException(`Неверный товар. Нужен артикул ${line.article}, ШК ${line.barcodes.join(', ')}.`);
  if (!state.source) throw new BadRequestException('Сначала отсканируйте короб или выберите «Без короба».');
  const result = structuredClone(state);
  result.lines[index].picks.push({ barcode, ...state.source, actorId, at: now.toISOString() });
  if (result.lines[index].picks.length === line.quantity) result.source = null;
  return result;
}

export async function readOzonPickState(db: any, assemblyId: string): Promise<OzonPickState | null> {
  const rows = await db.$queryRaw`SELECT "data" FROM "OzonFbsPickState" WHERE "assemblyId"=${assemblyId}`;
  return rows[0]?.data ?? null;
}
export async function writeOzonPickState(db: any, assemblyId: string, state: OzonPickState) {
  const data = JSON.stringify(state);
  await db.$executeRaw`INSERT INTO "OzonFbsPickState" ("assemblyId", "data") VALUES (${assemblyId}, ${data}::jsonb)
    ON CONFLICT ("assemblyId") DO UPDATE SET "data"=EXCLUDED."data", "updatedAt"=CURRENT_TIMESTAMP`;
}

// Existing imported SKUs may use a compound marketplaceProductId. Match exact tokens, never substrings.
export function resolveOzonLineSku(product: ReturnType<typeof ozonPostingProducts>[number], skus: any[]) {
  const candidates = skus.filter(sku => {
    const ids = String(sku.marketplaceProductId ?? '').split(':');
    return ids.includes(product.offerId) || ids.includes(String(product.productId)) ||
      sku.marketplaceOfferId === product.offerId ||
      (sku.barcodes ?? []).some((b: any) => product.barcodes.includes(b.value));
  });
  if (candidates.length !== 1) throw new BadRequestException(`Не найдено однозначное соответствие артикула Ozon ${product.offerId}. Проверьте карточку в WMS.`);
  const sku = candidates[0];
  if ((sku.needsChestnyZnak && !sku.isUnmarked) || sku.needsRelabel) throw new BadRequestException('Многотоварный заказ с КИЗ или переклейкой требует отдельной проверки.');
  if (!sku.barcodes?.length) throw new BadRequestException(`У артикула ${product.offerId} не задан ШК товара.`);
  return sku;
}
