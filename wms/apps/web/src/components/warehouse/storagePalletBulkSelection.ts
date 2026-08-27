export type StoragePalletSelectionItem = {
  id: string;
  boxes: ReadonlyArray<unknown>;
};

export function togglePalletSelection(
  current: ReadonlySet<string>,
  pallet: StoragePalletSelectionItem,
) {
  const next = new Set(current);
  if (next.has(pallet.id)) next.delete(pallet.id);
  else next.add(pallet.id);
  return next;
}

export function selectVisiblePallets(
  current: ReadonlySet<string>,
  visiblePallets: ReadonlyArray<StoragePalletSelectionItem>,
  selected: boolean,
) {
  const next = new Set(current);
  for (const pallet of visiblePallets) {
    if (selected) next.add(pallet.id);
    else next.delete(pallet.id);
  }
  return next;
}

export function allVisiblePalletsSelected(
  current: ReadonlySet<string>,
  visiblePallets: ReadonlyArray<StoragePalletSelectionItem>,
) {
  return visiblePallets.length > 0 && visiblePallets.every((pallet) => current.has(pallet.id));
}

export function prunePalletSelection(
  current: ReadonlySet<string>,
  availablePallets: ReadonlyArray<StoragePalletSelectionItem>,
) {
  const availableIds = new Set(availablePallets.map((pallet) => pallet.id));
  return new Set([...current].filter((id) => availableIds.has(id)));
}
