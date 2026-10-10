import type { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { directionProgress, OzonDirection } from './ozon-fbo-directions';

type PackingUnit = { skuId: string; state: string; wholeBox?: boolean; targetBoxId?: string | null };
type PackingBox = { boxId: string; boxCode?: string; direction?: string | null; closedAt?: Date | string | null; wholeBox?: boolean };

// FIX: advisory only; packing rechecks quota under the existing request transaction lock.
export function ozonPackingSuggestions(directions: OzonDirection[], boxes: PackingBox[], units: PackingUnit[]) {
    const progress = directionProgress(directions, boxes, units.map(u => ({ ...u, targetBoxId: u.targetBoxId ?? null })));
    const skus = [...new Set(units.filter(u => u.state === 'PICKED' && !u.wholeBox).map(u => u.skuId))];
    return skus.flatMap(skuId => {
        const needed = progress.filter(d => d.items.some(i => i.skuId === skuId && i.packed < i.quantity));
        const open = (name: string) => boxes.filter(b => b.direction === name && !b.closedAt && !b.wholeBox)
            .sort((a, b) => String(a.boxCode).localeCompare(String(b.boxCode)))[0];
        const direction = needed.find(d => open(d.name)) ?? needed[0];
        if (!direction) return [];
        const item = direction.items.find(i => i.skuId === skuId)!;
        return [{ skuId, barcode: item.barcode, direction: direction.name, targetBoxCode: open(direction.name)?.boxCode ?? null }];
    });
}

// FIX: new boxes and first unit commit together; every failure rolls back the enclosing transaction.
export async function prepareOzonProductBox(tx: Prisma.TransactionClient, requestId: string, target: { id: string; code: string }, direction: string | undefined) {
    const parcel = await tx.fboAssemblyBox.findUnique({ where: { activeBoxId: target.id } });
    if (parcel) {
        if (parcel.requestId !== requestId || parcel.closedAt || parcel.wholeBox || parcel.direction !== direction)
            throw new ConflictException('Сканируйте открытый короб указанного направления.');
        return parcel;
    }
    // A closed historical carton must not be implicitly reopened in product mode.
    if (await tx.fboAssemblyBox.count({ where: { requestId, boxId: target.id } }) ||
        await tx.stockBalance.count({ where: { boxId: target.id, quantity: { not: 0 } } }) ||
        await tx.productMark.count({ where: { boxId: target.id } }))
        throw new ConflictException('Нужен новый пустой короб указанного направления.');
    return tx.fboAssemblyBox.create({ data: { requestId, boxId: target.id, activeBoxId: target.id, boxCode: target.code, direction } });
}
