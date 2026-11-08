import { BadRequestException } from '@nestjs/common';
import bwipjs = require('bwip-js');
import pdfMake = require('pdfmake');
import { PDFDocument } from 'pdf-lib';
import { configurePdfMake } from '../../common/pdf/pdfmake';
import { ozonLinkedSkus } from './marketplace-product-links';
import { ozonPostingProducts, resolveOzonLineSku } from './ozon-fbs-pick-lines';
import { buildFbsStickersPdf, mergeFbsStickerPdfs } from './fbs-stickers-pdf';
import { fitSortingWarehouse } from './fbs-sorting-label';

type Selection = { id: string; connectionId: string };
type ProductLabel = { barcode: string; name: string; article: string; quantity: number };
type Plan = Selection & { connection: any; products: ProductLabel[]; crossBorder: boolean };
const MM = 72 / 25.4;
const key = (s: Selection) => JSON.stringify([s.connectionId, s.id]);
const clean = (v: unknown) => String(v ?? '').replace(/[\x00-\x1f]/g, ' ').trim();

// FIX: download-only, scoped to the existing deployment/client fabric opt-in.
// Never ship/assemble an order or manufacture/debit stock in a print request.
export async function fabricPairedLabels(db: any, clientId: string, selections: Selection[],
  resolve: (selections: Selection[]) => Promise<{ orders: any[] }>,
  json: (url: string, init: RequestInit) => Promise<any>,
  binary: (url: string, init: RequestInit) => Promise<{ buffer: Buffer }>) {
  if (process.env.WMS_FBS_FABRIC_CUT_ENABLED !== 'true' || !selections.length) return null;
  const enabled = await db.systemSetting.findUnique({ where: { key: `fabric.fbs.enabled.v1:${clientId}` } });
  if (enabled?.value?.enabled !== true) return null;
  const selected = [...new Map(selections.map(s => [key(s), s])).values()];
  const connectionIds = [...new Set(selected.map(s => s.connectionId))];
  const connections = await db.clientMarketplaceConnection.findMany({
    where: { id: { in: connectionIds }, clientId, isActive: true },
    select: { id: true, marketplace: true, sellerId: true, apiKey: true },
  });
  if (connections.length !== connectionIds.length) throw new BadRequestException('Подключение выбранного кабинета не найдено или отключено.');
  if (connections.some((c: any) => !['WILDBERRIES', 'OZON'].includes(c.marketplace))) return null;
  const catalog = await db.sku.findMany({ where: { clientId }, include: { barcodes: true } });
  const wbSelected = selected.filter(s => connections.find((c: any) => c.id === s.connectionId)?.marketplace === 'WILDBERRIES');
  const wbOrders = wbSelected.length ? (await resolve(wbSelected)).orders : [];
  const plans: Plan[] = [];
  // Resolve every product before requesting any printable file. No partial download.
  for (const selection of selected) {
    const connection = connections.find((c: any) => c.id === selection.connectionId);
    let products: ProductLabel[] = [], crossBorder = false;
    if (connection.marketplace === 'WILDBERRIES') {
      const matches = wbOrders.filter(o => key(o) === key(selection));
      if (matches.length !== 1) throw new BadRequestException(`Не найден выбранный заказ WB ${selection.id}.`);
      const order = matches[0];
      if (!['confirm', 'complete'].includes(order.supplierStatus) || order.category === 'cancelled')
        throw new BadRequestException(`Стикер WB ${selection.id} недоступен в текущем статусе.`);
      crossBorder = Number(order.crossBorderType ?? 0) !== 0;
      const sku = catalog.find((s: any) => s.id === order.product?.id);
      if (!sku) throw new BadRequestException(`Не найден товар заказа ${selection.id}. Обновите карточки товаров.`);
      // Printing does not depend on the raw-roll parser's supported colours.
      if (!sku.needsChestnyZnak || sku.isUnmarked) products = [labelProduct(sku, order.barcodes, order.itemCount, selection.id)];
    } else {
      if (!connection.sellerId) throw new BadRequestException('В подключении Ozon не заполнен Client-Id.');
      const response = await json('https://api-seller.ozon.ru/v3/posting/fbs/get', {
        method: 'POST', headers: ozonHeaders(connection), body: JSON.stringify({ posting_number: selection.id }), signal: AbortSignal.timeout(20000),
      });
      const posting = response.result ?? response;
      if (posting.posting_number !== selection.id) throw new BadRequestException('Ozon вернул другой номер заказа.');
      if (!['awaiting_deliver', 'arbitration', 'delivering', 'delivered'].includes(posting.status))
        throw new BadRequestException(`Ozon ещё не разрешил официальный стикер ${selection.id}. Сначала передайте сборку Ozon; скачивание не меняет статус заказа.`);
      const skus = await ozonLinkedSkus(db, clientId, connection.id, catalog);
      const lines = ozonPostingProducts(posting);
      const resolved = lines.map(line => ({ line, sku: resolveOzonLineSku(line, skus) }));
      products = resolved.map(({ line, sku }) =>
        labelProduct(sku, line.barcodes.length ? line.barcodes : sku.barcodes.map((b: any) => b.value), line.quantity, selection.id));
    }
    plans.push({ ...selection, connection, products, crossBorder });
  }
  if (!plans.some(p => p.products.length)) return null;
  const wbFiles = new Map<string, Buffer>();
  for (const connection of connections.filter((c: any) => c.marketplace === 'WILDBERRIES')) {
    for (const crossBorder of [false, true]) {
      const group = plans.filter(p => p.connectionId === connection.id && p.crossBorder === crossBorder);
      for (let i = 0; i < group.length; i += 100) {
        const chunk = group.slice(i, i + 100);
        if (chunk.some(p => !/^\d+$/.test(p.id) || !Number.isSafeInteger(Number(p.id)))) throw new BadRequestException('Некорректный номер заказа WB.');
        const response = await json('https://marketplace-api.wildberries.ru/api/v3/orders/stickers' +
          (crossBorder ? '/cross-border' : '?type=png&width=58&height=40'), {
          method: 'POST', headers: { Authorization: connection.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: chunk.map(p => Number(p.id)) }), signal: AbortSignal.timeout(30000),
        });
        for (const plan of chunk) {
          const stickers = (response.stickers ?? []).filter((s: any) => String(s.orderId) === plan.id && s.file);
          if (stickers.length !== 1 || (crossBorder && stickers[0].status !== 'ready'))
            throw new BadRequestException(`WB не вернул официальный стикер заказа ${plan.id}. Повторите скачивание позже.`);
          const sticker = stickers[0];
          wbFiles.set(key(plan), crossBorder ? Buffer.from(sticker.file, 'base64') :
            await buildFbsStickersPdf([{ orderId: plan.id, barcode: String(sticker.barcode ?? ''), file: sticker.file }]));
        }
      }
    }
  }
  const parts: Buffer[] = [];
  for (const plan of plans) {
    let official = wbFiles.get(key(plan));
    if (plan.connection.marketplace === 'OZON') {
      // One posting per response: batch PDF page order is not an order identity.
      official = (await binary('https://api-seller.ozon.ru/v2/posting/fbs/package-label', {
        method: 'POST', headers: { ...ozonHeaders(plan.connection), Accept: 'application/pdf' },
        body: JSON.stringify({ posting_number: [plan.id] }), signal: AbortSignal.timeout(30000),
      })).buffer;
    }
    if (!official?.length || (await PDFDocument.load(official)).getPageCount() === 0)
      throw new BadRequestException(`Нет официальной этикетки заказа ${plan.id}.`);
    for (const product of plan.products) parts.push(await buildFbsProductLabel(plan.id, product));
    parts.push(official);
  }
  return { buffer: await mergeFbsStickerPdfs(parts), count: plans.length };
}

function ozonHeaders(c: any) { return { 'Client-Id': c.sellerId, 'Api-Key': c.apiKey, 'Content-Type': 'application/json' }; }
function labelProduct(sku: any, orderBarcodes: string[], quantity: number, orderId: string): ProductLabel {
  const codes = [...new Set((orderBarcodes ?? []).map(clean).filter((b: string) => sku.barcodes.some((s: any) => s.value === b)))];
  if (codes.length !== 1 || !/^[\x21-\x7e]{4,48}$/.test(codes[0]))
    throw new BadRequestException(`Не найден однозначный ШК товара заказа ${orderId}. Проверьте карточку товара.`);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new BadRequestException(`Некорректное количество заказа ${orderId}.`);
  if (sku.needsChestnyZnak && !sku.isUnmarked) throw new BadRequestException(`Товар ${orderId} требует КИЗ; парная печать ткани не заменяет проверку маркировки.`);
  return { barcode: codes[0], name: clean(sku.name), article: clean(sku.internalSku || sku.article), quantity };
}

export async function buildFbsProductLabel(orderId: string, product: ProductLabel) {
  configurePdfMake();
  const fit = (text: string, count: number) => text.length > count ? text.slice(0, count - 1) + '…' : text;
  const line = (text: string, y: number, fontSize: number, bold = false): any => ({
    absolutePosition: { x: 2 * MM, y: y * MM }, columns: [{ width: 54 * MM, text, fontSize, bold, noWrap: true }],
  });
  const svg = bwipjs.toSVG({ bcid: 'code128', text: product.barcode, scale: 2, height: 10, includetext: false });
  const name = fitSortingWarehouse(product.name, 54 * MM, 9 * MM);
  return Buffer.from(await pdfMake.createPdf({
    pageSize: { width: 58 * MM, height: 40 * MM }, pageMargins: 0,
    defaultStyle: { font: 'DejaVuSans' },
    content: [line(`Заказ ${clean(orderId)}`, 1.5, 7, true),
      { svg, width: 50 * MM, height: 10 * MM, absolutePosition: { x: 4 * MM, y: 6 * MM } },
      line(product.barcode, 16.5, Math.min(7, 54 * MM / product.barcode.length)),
      ...name.text.split('\n').map((text, index) => line(text, 20 + index * name.fontSize * 1.3 / MM, name.fontSize, true)),
      line(`Артикул: ${fit(product.article, 30)}`, 30, 6),
      line(`Количество: ${product.quantity} шт.`, 34, 9, true)],
  }).getBuffer());
}
