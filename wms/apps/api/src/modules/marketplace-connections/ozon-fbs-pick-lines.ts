import { BadRequestException, ConflictException } from '@nestjs/common';
import { clientKizIdentity } from '../../common/kiz-client-registry';

export type OzonPick = { barcode: string; boxId: string | null; boxCode: string; actorId: string; at: string; kiz?: string; markId?: string };
export type OzonPickLine = {
  productId: number; offerId: string; quantity: number; skuId: string; requestItemId: string;
  name: string; article: string; barcodes: string[]; picks: OzonPick[];
  requiresKiz?: boolean;
};
export type OzonPickState = {
  version: 1; lines: OzonPickLine[];
  source: { boxId: string | null; boxCode: string } | null;
  submission: 'PICKING' | 'SUBMITTING' | 'UNKNOWN' | 'SUBMITTED' | 'COMPLETED';
  legacyScansDiscarded: boolean;
  // FIX: explicit version separates recovered per-unit marks from legacy unmarked scans.
  unitMarksVersion?: 1;
  pendingBarcode?: string;
  recovery?: { operationKey: string; actorId: string; recordedAt: string; reason: string; mode?: 'PACKED' | 'SHIPPED' };
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
  if (Array.isArray(marks) && marks.length && (state.unitMarksVersion !== 1 || marks.some(id => {
    const line = state.lines.find(l => String(l.productId) === String(id));
    return !line || line.picks.some(p => !clientKizIdentity(p.kiz ?? ''));
  }))) throw new BadRequestException('Ozon требует маркировку: не все экземпляры подтверждены КИЗ.');
  // FIX: WMS marking requirements remain mandatory even if Ozon omits them.
  const identities = state.lines.flatMap(l => l.picks.filter(p => l.requiresKiz || p.kiz).map(p => clientKizIdentity(p.kiz ?? '')));
  if (state.pendingBarcode || identities.some(k => !k) || new Set(identities).size !== identities.length)
    throw new ConflictException('Не все КИЗ подтверждены или КИЗ повторяется.');
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
  // FIX: the barcode selects a unit; only its KIZ completes a marked pick.
  if (line.requiresKiz) {
    if (state.unitMarksVersion !== 1) throw new ConflictException('Поштучный учёт КИЗ не включён.');
    result.pendingBarcode = barcode;
    return result;
  }
  result.lines[index].picks.push({ barcode, ...state.source, actorId, at: now.toISOString() });
  if (result.lines[index].picks.length === line.quantity) result.source = null;
  return result;
}

// FIX: durable counter + physical KIZ identity make a lost-response retry idempotent.
export function recordOzonUnitKiz(state: OzonPickState, kiz: string, expectedCount: unknown, actorId: string, now = new Date()): OzonPickState {
  const identity = clientKizIdentity(kiz), count = ozonPickCount(state);
  if (!identity) throw new BadRequestException('Отсканируйте полный КИЗ товара.');
  if (!Number.isSafeInteger(expectedCount) || Number(expectedCount) < 0 || Number(expectedCount) > count)
    throw new ConflictException('Обновите задание: отсутствует актуальный счётчик сканирования.');
  if (Number(expectedCount) < count) {
    if (clientKizIdentity(state.lines.flatMap(l => l.picks)[Number(expectedCount)]?.kiz ?? '') !== identity)
      throw new ConflictException('Этот номер сканирования уже занят другим КИЗ.');
    return state;
  }
  const line = ozonActiveLine(state);
  if (state.unitMarksVersion !== 1 || state.submission !== 'PICKING' || !line?.requiresKiz || !state.pendingBarcode || !state.source)
    throw new ConflictException('Сначала подтвердите источник и ШК товара.');
  if (state.lines.some(l => l.picks.some(p => clientKizIdentity(p.kiz ?? '') === identity)))
    throw new ConflictException('Этот КИЗ уже отобран в заказе.');
  const result = structuredClone(state), target = result.lines[state.lines.indexOf(line)];
  target.picks.push({ barcode: state.pendingBarcode, ...state.source, kiz, actorId, at: now.toISOString() });
  delete result.pendingBarcode;
  if (target.picks.length === target.quantity) result.source = null;
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
export function resolveOzonLineSku(product: ReturnType<typeof ozonPostingProducts>[number], skus: any[], allowMarked = false) {
  const candidates = skus.filter(sku => {
    const ids = String(sku.marketplaceProductId ?? '').split(':');
    return ids.includes(product.offerId) || ids.includes(String(product.productId)) ||
      sku.marketplaceOfferId === product.offerId ||
      (sku.barcodes ?? []).some((b: any) => product.barcodes.includes(b.value));
  });
  if (candidates.length !== 1) throw new BadRequestException(`Не найдено однозначное соответствие артикула Ozon ${product.offerId}. Проверьте карточку в WMS.`);
  const sku = candidates[0];
  if ((!allowMarked && sku.needsChestnyZnak && !sku.isUnmarked) || sku.needsRelabel) throw new BadRequestException('Многотоварный заказ с КИЗ или переклейкой требует отдельной проверки.');
  if (!sku.barcodes?.length) throw new BadRequestException(`У артикула ${product.offerId} не задан ШК товара.`);
  return sku;
}
