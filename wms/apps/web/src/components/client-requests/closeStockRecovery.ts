export type CloseStockSourceValue = {
  boxQuantities: Record<string, string>;
  noBoxQuantity: string;
  manualBoxCode: string;
  manualBoxQuantity: string;
};

type CloseStockRecoveryItem = {
  requestItemId: string;
  requestedQuantity: number;
  fbsOrders: Array<{
    assemblyStatus: string;
    sourceBoxPending: boolean;
  }>;
  boxes?: Array<{
    availableQuantity: number;
    selectedQuantity: number;
  }>;
};

export function isProblemCloseStockSourceItem(item: CloseStockRecoveryItem) {
  const hasUnknownFbsSource = item.fbsOrders.some(
    (order) => order.assemblyStatus !== 'COMPLETED' || order.sourceBoxPending,
  );
  if (hasUnknownFbsSource) return true;
  if (!item.boxes) return false;

  // FIX: сохранённый короб тоже проблемный, если выбранного количества в нём уже нет.
  const hasInsufficientSelectedBox = item.boxes.some(
    (box) =>
      box.selectedQuantity > 0 && box.selectedQuantity > box.availableQuantity,
  );
  if (hasInsufficientSelectedBox) return true;

  // ADDED: без сохранённого короба учитываем общий недостаток фактического остатка.
  const selectedQuantity = item.boxes.reduce(
    (sum, box) => sum + box.selectedQuantity,
    0,
  );
  const availableQuantity = item.boxes.reduce(
    (sum, box) => sum + box.availableQuantity,
    0,
  );
  return selectedQuantity === 0 && availableQuantity < item.requestedQuantity;
}

export function buildUnknownSourceNoBoxStockSources(items: CloseStockRecoveryItem[]) {
  // FIX: источники создаются только для FBS-позиций с незавершённой сборкой
  // или с отсутствующим исходным коробом.
  const unknownSourceItems = items.filter(isProblemCloseStockSourceItem);

  return {
    unknownSourceItems,
    stockSources: unknownSourceItems.map((item) => ({
      requestItemId: item.requestItemId,
      noBox: true as const,
      quantity: item.requestedQuantity,
    })),
  };
}

export function selectAllUnknownSourcesWithoutBox(
  items: CloseStockRecoveryItem[],
  values: Record<string, CloseStockSourceValue>,
  touchedItemIds: string[],
) {
  // ADDED: массовый выбор очищает предполагаемые короба только у проблемных позиций.
  const { unknownSourceItems } = buildUnknownSourceNoBoxStockSources(items);

  return {
    unknownSourceItems,
    values: {
      ...values,
      ...Object.fromEntries(
        unknownSourceItems.map((item) => [
          item.requestItemId,
          {
            boxQuantities: Object.fromEntries(
              Object.keys(values[item.requestItemId]?.boxQuantities ?? {}).map(
                (boxCode) => [boxCode, ''],
              ),
            ),
            manualBoxCode: '',
            manualBoxQuantity: '',
            noBoxQuantity: String(item.requestedQuantity),
          } satisfies CloseStockSourceValue,
        ]),
      ),
    },
    touchedItemIds: [
      ...new Set([
        ...touchedItemIds,
        ...unknownSourceItems.map((item) => item.requestItemId),
      ]),
    ],
  };
}
