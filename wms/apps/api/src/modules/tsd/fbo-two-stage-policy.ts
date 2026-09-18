import type { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
export const fboClosePickEnabled = () => process.env.WMS_FBO_CLOSE_PICK_ENABLED === 'true';
// FIX: preserve requested quantities while all later stock operations use the frozen physical target.
// A recorded closure remains authoritative even if the rollout flag is subsequently disabled.
export function closedFboItems<T extends { id: string; quantity: number }>(items: T[], closure: Prisma.JsonValue | null | undefined): T[] {
    if (closure == null) return items;
    const value = closure as { version?: number; quantities?: Record<string, number> };
    if (value.version !== 1 || !value.quantities || Array.isArray(value.quantities)
        || Object.keys(value.quantities).length !== items.length
        || items.some(i => !Number.isSafeInteger(value.quantities![i.id]) || value.quantities![i.id] < 0 || value.quantities![i.id] > i.quantity))
        throw new ConflictException('Результат завершения отбора не совпадает с заявкой. Требуется сверка.');
    return items.map(i => ({ ...i, quantity: value.quantities![i.id] }));
}
export const fboTwoStageEnabled = () => process.env.WMS_FBO_TWO_STAGE_ENABLED === 'true';
export async function hasLegacyFboProgress(db: Prisma.TransactionClient, requestId: string) {
    return !!(await db.stockMovement.findFirst({ where: { sourceDocument: requestId, type: { in: ['PICK', 'PACK', 'SHIP'] } } }) ||
        await db.tsdOperation.findFirst({ where: { payload: { path: ['requestId'], equals: requestId }, status: 'ACCEPTED', operationType: { in: ['move_scan', 'assembly_stage', 'box_search_scan'] } } }));
}
// FIX: both the new screen and old bulk endpoints use the same eligibility rule.
export async function isFboTwoStageRequest(db: Prisma.TransactionClient, requestId: string) {
    if (!fboTwoStageEnabled())
        return false;
    const r = await db.clientRequest.findUnique({ where: { id: requestId }, select: { type: true, status: true, client: { select: { storesWithoutBoxes: true } }, _count: { select: { fbsOrderLinks: true, packages: true } } } });
    if (!r || r.type !== 'OUTBOUND' || r._count.fbsOrderLinks || r.client.storesWithoutBoxes)
        return false;
    if (await db.fboAssembly.findUnique({ where: { requestId } }))
        return true;
    return !r._count.packages && ['SUBMITTED', 'APPROVED', 'IN_WORK'].includes(r.status) && !await hasLegacyFboProgress(db, requestId);
}
// FIX: picking and packing count the same physical units; packing is not another pick.
export function remainingFboLines<T extends {
    id: string;
    skuId: string | null;
    quantity: number;
}>(lines: T[], units: Array<{
    requestItemId: string;
    state: string;
}>) {
    return lines.map(line => {
        const active = units.filter(u => u.requestItemId === line.id && u.state !== 'RETURNED');
        return { ...line, needed: line.quantity, picked: active.length,
            packed: active.filter(u => u.state === 'PACKED').length, remaining: Math.max(0, line.quantity - active.length) };
    });
}
// FIX: the whole-box shortcut is allowed only for a complete, reconciled single-SKU box.
export function wholeBoxDecision(balances: Array<{
    skuId: string;
    quantity: number;
    status: string;
}>, demand: Record<string, number>, marks: Array<{
    skuId: string;
    identity: string;
    status: string;
}>, marked: boolean, markedSkuIds?: ReadonlySet<string>) {
    const positive = balances.filter(b => b.quantity > 0);
    // FIX: our installation may take mixed contents only when every SKU and physical mark fits.
    if (process.env.WMS_FBO_MIXED_WHOLE_BOX_ENABLED === 'true') {
        if (balances.some(b => !Number.isSafeInteger(b.quantity) || b.quantity < 0))
            return { allowed: false, recount: true, quantity: 0 };
        if (!positive.length || positive.some(b => b.status !== 'AVAILABLE'))
            return { allowed: false, recount: false, quantity: 0 };
        const quantities = new Map<string, number>();
        for (const b of positive) quantities.set(b.skuId, (quantities.get(b.skuId) ?? 0) + b.quantity);
        const quantity = positive.reduce((sum, b) => sum + b.quantity, 0);
        const validMarks = marks.every(m => quantities.has(m.skuId) && m.status === 'AVAILABLE' && m.identity)
            && new Set(marks.map(m => m.identity)).size === marks.length;
        const consistent = validMarks && [...quantities].every(([skuId, count]) => {
            const actual = marks.filter(m => m.skuId === skuId).length;
            const required = (markedSkuIds ? markedSkuIds.has(skuId) : marked) || actual > 0;
            return actual === (required ? count : 0);
        });
        return { allowed: consistent && [...quantities].every(([skuId, count]) => (demand[skuId] ?? 0) >= count), recount: !consistent, quantity };
    }
    if (balances.some(b => b.quantity < 0))
        return { allowed: false, recount: true, quantity: 0 };
    const skus = new Set(positive.map(b => b.skuId));
    if (skus.size !== 1 || positive.some(b => b.status !== 'AVAILABLE'))
        return { allowed: false, recount: false, quantity: 0 };
    const skuId = positive[0].skuId;
    const quantity = positive.reduce((sum, b) => sum + b.quantity, 0);
    const consistent = marked ? (marks.length === quantity && marks.every(m => m.skuId === skuId && m.status === 'AVAILABLE' && m.identity) && new Set(marks.map(m => m.identity)).size === quantity) : marks.length === 0;
    return { allowed: consistent && (demand[skuId] ?? 0) >= quantity, recount: !consistent, quantity };
}

// FIX: reserve demand for complete reconciled boxes before allocating loose units.
// Re-evaluate after each choice so two boxes cannot consume the same remaining demand.
export function prioritizeFboWholeBoxes<T extends {
    balances: Array<{ skuId: string; quantity: number; status: string }>;
    productMarks: Array<{ skuId: string; status: string }>;
}>(boxes: T[], demand: Record<string, number>, decide: (box: T, remaining: Record<string, number>) => ReturnType<typeof wholeBoxDecision>): T[] {
    const remaining = { ...demand }, pending = [...boxes], result: T[] = [];
    for (;;) {
        let best = -1, quantity = 0, exact = false;
        for (let i = 0; i < pending.length; i++) {
            const decision = decide(pending[i], remaining);
            if (!decision.allowed) continue;
            const quantities = new Map<string, number>();
            for (const b of pending[i].balances.filter(b => b.quantity > 0)) quantities.set(b.skuId, (quantities.get(b.skuId) ?? 0) + b.quantity);
            const fitsExactly = [...quantities].every(([skuId, count]) => remaining[skuId] === count);
            if (best < 0 || (fitsExactly && !exact) || (fitsExactly === exact && decision.quantity > quantity)) {
                best = i; quantity = decision.quantity; exact = fitsExactly;
            }
        }
        if (best < 0) break;
        const box = pending.splice(best, 1)[0];
        // FIX: a mixed box consumes demand separately for every SKU.
        for (const b of box.balances.filter(b => b.quantity > 0)) remaining[b.skuId] -= b.quantity;
        result.push(box);
    }
    return [...result, ...pending];
}
