import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';

// ADDED: opt-in, role-based, branch-scoped access; no effect on the sold installation.
export function assertSortingAdmin(user: Pick<AuthUser, 'roleCodes' | 'activeWarehouseId' | 'isDemo'>) {
  // FIX: ADMIN authority never bridges the demo/production data boundary.
  if (process.env.WMS_PALLET_SORTING_ENABLED !== 'true' || !user.roleCodes.includes('ADMIN') || user.isDemo) {
    throw new ForbiddenException('Сортировка и перемещение доступны только администратору при включённом сервисе.');
  }
  if (!user.activeWarehouseId) throw new BadRequestException('Сначала выберите филиал.');
}

export function missingSortingBoxes(expected: string[], scanned: string[]) {
  if (scanned.some(id => !expected.includes(id))) throw new ConflictException('Короб не входит в исходный состав сортировки.');
  return expected.filter(id => !scanned.includes(id));
}

export function confirmSortingSnapshot(current: string, supplied: string, consent: boolean, quantity: number) {
  if (!supplied || current !== supplied) throw new ConflictException('Остатки или задания изменились. Получите свежие расхождения и подтвердите их заново.');
  if (quantity > 0 && consent !== true) throw new ConflictException('Требуется отдельное подтверждение списания недостающего товара.');
}

export function sortingKizIdentity(value: string) {
  const identity = value.trim().replace(/<GS>/gi, '\u001d').split('\u001d')[0];
  if (!/^01\d{14}21[^\u0000-\u001f]{13}$/.test(identity)) throw new BadRequestException('Отсканируйте полный КИЗ товара.');
  return identity;
}

type SortingRouteTask = {
  status: string; boxId: string | null; reservedBoxId: string | null;
  barcode: string | null; kiz: string | null; sourceBarcode: string | null;
  relabelConfirmedAt: unknown;
};
export function sortingTaskCanReroute(task: SortingRouteTask, removedBoxIds: string[]) {
  // FIX: a box scan alone can be rerouted; physical item scans and returns cannot be reset.
  return ['RESERVED', 'WAITING_STOCK', 'RELEASED', 'IN_PROGRESS'].includes(task.status) &&
    Boolean((task.boxId && removedBoxIds.includes(task.boxId)) ||
      (task.reservedBoxId && removedBoxIds.includes(task.reservedBoxId))) &&
    !task.barcode && !task.kiz && !task.sourceBarcode && !task.relabelConfirmedAt;
}
