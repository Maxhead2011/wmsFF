import type {Prisma} from '@prisma/client';
import type {AuthUser} from '../auth/auth.types';

const actions = new Set(['PACK_PRODUCT', 'PACK_UNIT', 'MANUAL_PACK_UNIT', 'PACK_BOX']);
const unknownProduct = 'Товар не определён по журналу';
const unknownActor = 'Сотрудник не определён по журналу';
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e9 ? value : null;
const clean = (value: unknown, groupSeparator = false) => typeof value === 'string' ? value.replace(groupSeparator ? /[\x00-\x1c\x1e\x1f]/g : /[\x00-\x1f]/g, '').replace(/^ +| +$/g, '') : '';

type PackedUnit = {id: string; requestId: string; requestItemId: string; skuId: string;
  state: string; packedByUserId: string | null; targetBoxCode: string | null; packedAt: Date | null};
export type FboVideoCaptionContext = {requestId: string; operationId: string; action: string;
  user: Pick<AuthUser, 'id' | 'name' | 'deviceId' | 'deviceCode'>;
  unit?: PackedUnit | null; barcode?: string | null; kiz?: string | null; boxNumber?: string | null};

// FIX: only this deployment opts in; the sold WMS has no additional reads or audit fields.
export async function createFboVideoCaption(tx: Prisma.TransactionClient, context: FboVideoCaptionContext) {
  const {user, unit, requestId, operationId, action} = context;
  if (process.env.WMS_CONTOUR_FBO_CAPTIONS_ENABLED !== 'true' || !actions.has(action) || !user.id || !clean(user.deviceCode)) return undefined;
  const wholeBox = action === 'PACK_BOX';
  if (!wholeBox && (!unit || unit.requestId !== requestId || unit.packedByUserId !== user.id || unit.state !== 'PACKED' ||
      !(unit.packedAt instanceof Date) || !Number.isFinite(unit.packedAt.getTime()))) throw new Error('FBO caption unit identity mismatch');

  // These reads run after the physical mutation, in its existing Serializable transaction.
  // They never use the next suggested product or a mutable HTTP response plan.
  const request = await tx.clientRequest.findUnique({where: {id: requestId},
    select: {id: true, number: true, items: {select: {id: true, skuId: true, name: true, quantity: true,
      sku: {select: {id: true, name: true, article: true}}}}}});
  const rows = await tx.$queryRaw<Array<{pickClosure: unknown}>>`SELECT "pickClosure" FROM "FboAssembly" WHERE "requestId" = ${requestId}`;
  const packedCount = count(await tx.fboAssemblyUnit.count({where: {requestId, state: 'PACKED'}}));
  const items = request?.items ?? [];
  const line = !wholeBox && unit ? items.find(item => item.id === unit.requestItemId && item.skuId === unit.skuId && item.sku?.id === unit.skuId) : undefined;
  let totalCount: number | null = null;
  if (request && rows.length === 1) {
    const closure = rows[0].pickClosure as {version?: unknown; quantities?: Record<string, unknown>} | null;
    if (closure == null) totalCount = items.every(item => count(item.quantity) !== null) ? count(items.reduce((sum, item) => sum + item.quantity, 0)) : null;
    else if (closure.version === 1 && closure.quantities && typeof closure.quantities === 'object' && !Array.isArray(closure.quantities) &&
        Object.keys(closure.quantities).length === items.length && items.every(item => count(closure.quantities![item.id]) !== null && Number(closure.quantities![item.id]) <= item.quantity)) {
      totalCount = count(items.reduce((sum, item) => sum + Number(closure.quantities![item.id]), 0));
    }
  }
  let unresolved = !request || packedCount === null || totalCount === null || (!wholeBox && !line);
  const bounded = (value: unknown, limit: number, groupSeparator = false) => {const text = clean(value, groupSeparator); if (text.length > limit) unresolved = true; return text.slice(0, limit);};
  const productName = wholeBox ? 'Упаковка короба' : bounded(line?.name || line?.sku?.name, 500);
  const actorName = bounded(user.name, 200);
  const boxNumber = bounded(wholeBox ? context.boxNumber : unit?.targetBoxCode, 200);
  const barcode = wholeBox ? '' : bounded(context.barcode, 256);
  const kiz = wholeBox ? '' : bounded(context.kiz, 1024, true); // ASCII GS is significant, including a terminal GS.
  const productSku = wholeBox ? '' : bounded(line?.sku?.article, 200);
  const deviceCode = bounded(user.deviceCode, 100);
  const orderRef = bounded(request?.number == null ? requestId : String(request.number), 200);
  if (!productName || !actorName || !boxNumber || (!wholeBox && !barcode)) unresolved = true;
  return {schemaVersion: 1, source_id: `fbo:${requestId}:${operationId.slice(0, 100)}`.slice(0, 200),
    occurred_at: (wholeBox ? Date.now() : unit!.packedAt!.getTime()) / 1000,
    barcode, kiz, product_name: productName || unknownProduct, actor_name: actorName || unknownActor,
    product_sku: productSku, box_number: boxNumber, order_ref: orderRef, device_code: deviceCode,
    packed_count: packedCount, total_count: totalCount, kind: 'assembly' as const,
    status: unresolved ? 'unresolved' as const : 'accepted' as const,
    evidence: {request_id: requestId, operation_id: operationId, action, actor_id: user.id,
      device_id: user.deviceId ?? null, device_code: deviceCode,
      unit_id: wholeBox ? null : unit!.id, sku_id: wholeBox ? null : unit!.skuId,
      request_item_id: wholeBox ? null : unit!.requestItemId}};
}
