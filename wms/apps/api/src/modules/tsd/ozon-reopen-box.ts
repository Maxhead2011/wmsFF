import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertSupplyMutable } from '../client-requests/ozon-supply-policy';
// FIX: reopening is navigation within the existing destination, never manual stock insertion.
export function ozonReopenSupported(shipment: {integration: unknown}|null) {
    if (!shipment || process.env.WMS_OZON_REOPEN_BOX_ENABLED !== 'true') return false;
    try { assertSupplyMutable(shipment.integration, 'REOPEN_BOX'); return true; } catch { return false; }
}
export async function reopenOzonBox(tx: Prisma.TransactionClient, shipment: {integration: unknown}|null,
    requestId: string, box: {id:string;requestId:string;direction:string|null;closedAt:Date|null;wholeBox:boolean}|null,
    direction?: string) {
    if (!shipment || process.env.WMS_OZON_REOPEN_BOX_ENABLED !== 'true')
        throw new ConflictException('Догруз закрытого короба Ozon недоступен.');
    assertSupplyMutable(shipment.integration, 'REOPEN_BOX');
    if (!box || box.requestId !== requestId || !box.closedAt || box.wholeBox || !direction || box.direction !== direction)
        throw new ConflictException('Выберите закрытый короб этой заявки и его направление.');
    await tx.fboAssemblyBox.update({where:{id:box.id},data:{closedAt:null,confirmedAt:null,confirmedByUserId:null}});
}
