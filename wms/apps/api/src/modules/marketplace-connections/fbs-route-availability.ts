export type FbsRouteReservation = {
  taskId: string;
  boxId: string | null;
  itemCount: number;
  releasableBackground: boolean;
};

export type FbsBoxAvailability = {
  availableQuantity: number;
  reservedQuantity: number;
  ownReservationQuantity: number;
  releasableBackgroundQuantity: number;
  freeQuantity: number;
  claimableQuantity: number;
  accepted: boolean;
};

export type FbsRejectedBoxReason = {
  code: 'FBS_WRONG_BOX' | 'FBS_ROUTE_STALE';
  message: string;
};

/**
 * // FIX: One calculation is used by route preview, pallet validation and the
 * physical box claim. A route may count only untouched AUTO reservations as
 * releasable; started/scanned tasks always remain protected.
 */
export function evaluateFbsBoxAvailability(input: {
  boxId: string;
  availableQuantity: number;
  candidateTaskId: string;
  candidateAssignedBoxId: string | null;
  requiredQuantity: number;
  reservations: FbsRouteReservation[];
}): FbsBoxAvailability {
  const requiredQuantity = Math.max(1, input.requiredQuantity);
  const boxReservations = input.reservations.filter(
    (reservation) => reservation.boxId === input.boxId,
  );
  const ownReservationQuantity = boxReservations
    .filter((reservation) => reservation.taskId === input.candidateTaskId)
    .reduce((sum, reservation) => sum + Math.max(1, reservation.itemCount), 0);
  const reservedQuantity = boxReservations
    .reduce((sum, reservation) => sum + Math.max(1, reservation.itemCount), 0);
  const releasableBackgroundQuantity = boxReservations
    .filter(
      (reservation) =>
        reservation.taskId !== input.candidateTaskId &&
        reservation.releasableBackground,
    )
    .reduce((sum, reservation) => sum + Math.max(1, reservation.itemCount), 0);
  const freeQuantity = Math.max(0, input.availableQuantity - reservedQuantity);
  const claimableQuantity = Math.max(
    0,
    freeQuantity +
      releasableBackgroundQuantity +
      (input.candidateAssignedBoxId === input.boxId ? ownReservationQuantity : 0),
  );
  return {
    availableQuantity: input.availableQuantity,
    reservedQuantity,
    ownReservationQuantity,
    releasableBackgroundQuantity,
    freeQuantity,
    claimableQuantity,
    accepted: claimableQuantity >= requiredQuantity,
  };
}

/**
 * // FIX: Do not claim that another request took the item when the employee
 * scanned a different box that has no stock for the current SKU.
 */
export function describeFbsRejectedBox(input: {
  scannedBoxCode: string;
  assignedBoxCode: string | null;
  productLabel: string;
  availableQuantity: number;
}): FbsRejectedBoxReason {
  const assignedBoxCode = input.assignedBoxCode?.trim() || null;
  const scannedDifferentBox = Boolean(
    assignedBoxCode &&
    assignedBoxCode.toUpperCase() !== input.scannedBoxCode.toUpperCase(),
  );
  if (scannedDifferentBox && input.availableQuantity <= 0) {
    return {
      code: 'FBS_WRONG_BOX',
      message: `В коробе ${input.scannedBoxCode} нет товара «${input.productLabel}» для текущего задания. Маршрут показывает короб ${assignedBoxCode}; отсканируйте его.`,
    };
  }
  return {
    code: 'FBS_ROUTE_STALE',
    message: `Свободный товар из короба ${input.scannedBoxCode} уже закреплён другой заявкой. Маршрут обновлён; отсканируйте следующий показанный короб.`,
  };
}

export type FbsRouteFingerprintRow = {
  taskId: string;
  status: string;
  skuId: string;
  quantity: number;
  boxId: string | null;
  boxCode: string | null;
  palletCode: string | null;
  updatedAt: string;
};

/** // ADDED: Stable live-data version; unchanged input always has one version. */
export function fbsRouteFingerprint(rows: FbsRouteFingerprintRow[]) {
  const value = [...rows]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((row) => [
      row.taskId,
      row.status,
      row.skuId,
      Math.max(0, row.quantity),
      row.boxId ?? '',
      row.boxCode ?? '',
      row.palletCode ?? '',
    ].join('|'))
    .join('\n');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `FBSR-${hash.toString(36).toUpperCase().padStart(7, '0')}`;
}

export function diffFbsRouteBoxes(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    addedBoxes: [...afterSet].filter((box) => !beforeSet.has(box)).sort(),
    removedBoxes: [...beforeSet].filter((box) => !afterSet.has(box)).sort(),
  };
}
