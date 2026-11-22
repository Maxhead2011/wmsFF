import { directionProgress } from '../tsd/ozon-fbo-directions';
import { ConflictException } from '@nestjs/common';
import { assertClientRequestKizShipment } from '../../common/kiz-client-review';
import { fboCompletionPackages, saveFboCompletionSelections, validateFboPackedBoxes } from '../tsd/fbo-completion-batch';

export const marketFboCompletionEnabled = () => process.env.WMS_FBO_MARKET_COMPLETION_ENABLED === 'true';

// FIX: called only after exact marketplace acceptance, under the shipment transaction lock.
export async function completeMarketAcceptedFbo(tx: any, request: any, user: any, packageRequest: (dto: any) => Promise<any>) {
  const assembly = await tx.fboAssembly.findUnique({ where: { requestId: request.id } });
  if (!assembly || assembly.phase === 'COMPLETED') return;
  const boxes = await tx.fboAssemblyBox.findMany({ where: { requestId: request.id } });
  const units = await tx.fboAssemblyUnit.findMany({ where: { requestId: request.id, state: { not: 'RETURNED' } } });
  const counts = new Map<string, number>();
  for (const unit of units) {
    if (unit.state !== 'PACKED') throw new ConflictException('Сдача подтверждена, но есть неупакованные единицы. Требуется сверка состава.');
    counts.set(unit.requestItemId, (counts.get(unit.requestItemId) ?? 0) + 1);
  }
  if (!boxes.length || request.items.some((item: any) => counts.get(item.id) !== item.quantity) ||
      [...counts.keys()].some(id => !request.items.some((item: any) => item.id === id))) {
    throw new ConflictException('Сдача подтверждена, но состав упаковки не совпадает с заявкой.');
  }
  const shipment = await tx.ozonFboShipment.findUnique({ where: { requestId: request.id } });
  if (shipment && directionProgress(shipment.directions, boxes, units).some(direction =>
      direction.items.some(item => item.packed !== item.quantity))) {
    throw new ConflictException('Состав коробов не совпадает с направлениями поставки Ozon.');
  }
  await validateFboPackedBoxes(tx, request, boxes, units);
  await assertClientRequestKizShipment(tx, request, user);
  const packages = fboCompletionPackages(request, boxes, units);
  await saveFboCompletionSelections(tx, request, boxes, packages);
  // The persisted packed status can precede actual PACK movements, as in request 3211.
  await tx.clientRequest.update({ where: { id: request.id }, data: { status: 'IN_WORK' } });
  await packageRequest({ requestId: request.id, idempotencyKey: 'fbo-pack:' + request.id,
    boxes: boxes.length, packedUnits: units.length, packages });
  await tx.productMark.updateMany({ where: { id: { in: units.filter((unit: any) => unit.markId).map((unit: any) => unit.markId) }, status: 'PACKING' }, data: { status: 'SHIPPING' } });
  await tx.fboAssemblyUnit.updateMany({ where: { requestId: request.id }, data: { activeMarkId: null } });
  await tx.fboAssemblyBox.updateMany({ where: { requestId: request.id }, data: { activeBoxId: null } });
  await tx.fboAssembly.update({ where: { requestId: request.id }, data: { phase: 'COMPLETED' } });
  await tx.auditLog.create({ data: { entity: 'ClientRequest', entityId: request.id,
    action: 'FBO_MARKET_STAGES_COMPLETED',
    payload: { previousPhase: assembly.phase, previousStatus: request.status, packedUnits: units.length, boxes: boxes.length, confirmationSource: 'MARKETPLACE' } } });
}
