export const STORAGE_BOX_MIN_QUANTITY = 16;
export const STORAGE_BOX_MAX_QUANTITY = 20;
export const STORAGE_PALLET_MIN_BOXES = 16;
export const STORAGE_PALLET_MAX_BOXES = 20;

export type StorageOptimizationSourceRow = {
  warehouseId: string;
  warehouseName: string;
  skuId: string;
  barcode: string | null;
  article: string | null;
  productName: string;
  color: string | null;
  size: string | null;
  sourcePalletSort: string | null;
  sourceBox: string;
  quantity: number;
};

export type StorageOptimizationTargetBox = {
  id: string;
  label: string;
  physicalBoxCode: string | null;
  warehouseId: string;
  warehouseName: string;
  strategy: 'BARCODE' | 'ARTICLE';
  article: string;
  colors: string[];
  sizes: string[];
  barcodes: string[];
  plannedQuantity: number;
  targetPalletSort: string;
};

export type StorageOptimizationPlanRow = StorageOptimizationSourceRow & {
  destinationBox: string;
  destinationPhysicalBox: string | null;
  destinationPalletSort: string;
  strategy: 'BARCODE' | 'ARTICLE';
  action: 'KEEP' | 'MOVE';
};

export type StorageOptimizationPlan = {
  summary: {
    totalUnits: number;
    sourceBoxes: number;
    targetBoxes: number;
    sourcePalletSorts: number;
    targetPalletSorts: number;
    idealTargetPalletSorts: number;
    movementUnits: number;
    idealTargetBoxes: number;
  };
  targetBoxes: StorageOptimizationTargetBox[];
  rows: StorageOptimizationPlanRow[];
};

type NormalizedSourceRow = StorageOptimizationSourceRow & {
  barcodeKey: string;
  articleKey: string;
};

type Allocation = {
  source: NormalizedSourceRow;
  quantity: number;
};

type TargetDraft = Omit<StorageOptimizationTargetBox, 'id' | 'label' | 'physicalBoxCode' | 'targetPalletSort'> & {
  articleKey: string;
  allocations: Allocation[];
};

export function buildStorageOptimizationPlan(sourceRows: StorageOptimizationSourceRow[]): StorageOptimizationPlan {
  const rows = sourceRows
    .map(normalizeSourceRow)
    .filter((row): row is NormalizedSourceRow => row !== null)
    .sort(compareSourceRows);

  const drafts: TargetDraft[] = [];
  for (const warehouseRows of groupValues(rows, (row) => row.warehouseId)) {
    const articleRemainders: NormalizedSourceRow[] = [];

    // FIX: reserve as many ideal single-barcode boxes as the quantity allows.
    for (const barcodeRows of groupValues(warehouseRows, (row) => row.barcodeKey)) {
      const total = sumQuantity(barcodeRows);
      const pureBoxCount = Math.floor(total / STORAGE_BOX_MIN_QUANTITY);
      const pureQuantity = Math.min(total, pureBoxCount * STORAGE_BOX_MAX_QUANTITY);
      const queue = cloneRows(barcodeRows);

      for (const quantity of distributeQuantity(pureQuantity, pureBoxCount)) {
        drafts.push(createDraft(takeFromQueue(queue, quantity), 'BARCODE'));
      }
      articleRemainders.push(...queue.filter((row) => row.quantity > 0));
    }

    // FIX: quantities that cannot fill a barcode-only box may mix only inside one article.
    for (const articleRows of groupValues(articleRemainders, (row) => row.articleKey)) {
      const queue = cloneRows(articleRows);
      for (const quantity of splitByMaximum(sumQuantity(queue))) {
        drafts.push(createDraft(takeFromQueue(queue, quantity), 'ARTICLE'));
      }
    }
  }

  const targets = finalizeTargets(drafts);
  const planRows = targets.flatMap(({ target, allocations }) =>
    allocations.map<StorageOptimizationPlanRow>((allocation) => ({
      warehouseId: allocation.source.warehouseId,
      warehouseName: allocation.source.warehouseName,
      skuId: allocation.source.skuId,
      barcode: allocation.source.barcode,
      article: allocation.source.article,
      productName: allocation.source.productName,
      color: allocation.source.color,
      size: allocation.source.size,
      sourcePalletSort: allocation.source.sourcePalletSort,
      sourceBox: allocation.source.sourceBox,
      quantity: allocation.quantity,
      destinationBox: target.label,
      destinationPhysicalBox: target.physicalBoxCode,
      destinationPalletSort: target.targetPalletSort,
      strategy: target.strategy,
      action: target.physicalBoxCode === allocation.source.sourceBox ? 'KEEP' : 'MOVE',
    })),
  );

  planRows.sort((left, right) =>
    compareText(left.warehouseName, right.warehouseName) ||
    compareText(left.destinationPalletSort, right.destinationPalletSort) ||
    compareText(left.destinationBox, right.destinationBox) ||
    compareText(left.sourcePalletSort, right.sourcePalletSort) ||
    compareText(left.sourceBox, right.sourceBox) ||
    compareText(left.barcode, right.barcode),
  );

  const targetBoxes = targets.map(({ target }) => target);
  const targetPalletBoxCounts = countBy(targetBoxes, (box) => box.targetPalletSort);
  return {
    summary: {
      totalUnits: planRows.reduce((sum, row) => sum + row.quantity, 0),
      sourceBoxes: new Set(rows.map((row) => row.sourceBox)).size,
      targetBoxes: targetBoxes.length,
      sourcePalletSorts: new Set(rows.map((row) => row.sourcePalletSort).filter(Boolean)).size,
      targetPalletSorts: new Set(targetBoxes.map((box) => box.targetPalletSort)).size,
      idealTargetPalletSorts: [...targetPalletBoxCounts.values()].filter(
        (count) => count >= STORAGE_PALLET_MIN_BOXES && count <= STORAGE_PALLET_MAX_BOXES,
      ).length,
      movementUnits: planRows.filter((row) => row.action === 'MOVE').reduce((sum, row) => sum + row.quantity, 0),
      idealTargetBoxes: targetBoxes.filter(
        (box) => box.plannedQuantity >= STORAGE_BOX_MIN_QUANTITY && box.plannedQuantity <= STORAGE_BOX_MAX_QUANTITY,
      ).length,
    },
    targetBoxes,
    rows: planRows,
  };
}

function normalizeSourceRow(row: StorageOptimizationSourceRow): NormalizedSourceRow | null {
  const quantity = Math.floor(Number(row.quantity));
  const sourceBox = clean(row.sourceBox);
  const warehouseId = clean(row.warehouseId);
  const skuId = clean(row.skuId);
  if (!sourceBox || !warehouseId || !skuId || !Number.isFinite(quantity) || quantity <= 0) return null;

  const barcode = clean(row.barcode);
  const article = clean(row.article);
  return {
    ...row,
    warehouseId,
    warehouseName: clean(row.warehouseName) || warehouseId,
    skuId,
    barcode,
    article,
    productName: clean(row.productName) || skuId,
    color: clean(row.color),
    size: clean(row.size),
    sourcePalletSort: clean(row.sourcePalletSort),
    sourceBox,
    quantity,
    barcodeKey: barcode ? `BARCODE:${barcode.toLocaleUpperCase('ru-RU')}` : `SKU:${skuId}`,
    articleKey: article ? `ARTICLE:${article.toLocaleUpperCase('ru-RU')}` : `SKU:${skuId}`,
  };
}

function createDraft(allocations: Allocation[], strategy: 'BARCODE' | 'ARTICLE'): TargetDraft {
  const first = allocations[0]?.source;
  if (!first) throw new Error('Невозможно создать пустой целевой короб.');

  return {
    warehouseId: first.warehouseId,
    warehouseName: first.warehouseName,
    strategy,
    articleKey: first.articleKey,
    article: first.article || first.productName,
    colors: uniqueSorted(allocations.map((item) => item.source.color)),
    sizes: uniqueSorted(allocations.map((item) => item.source.size)),
    barcodes: uniqueSorted(allocations.map((item) => item.source.barcode || `БЕЗ ШК · ${item.source.skuId}`)),
    plannedQuantity: allocations.reduce((sum, item) => sum + item.quantity, 0),
    allocations,
  };
}

function finalizeTargets(drafts: TargetDraft[]) {
  const sortedDrafts = [...drafts].sort(
    (left, right) =>
      compareText(left.warehouseName, right.warehouseName) ||
      compareText(left.articleKey, right.articleKey) ||
      (left.strategy === right.strategy ? 0 : left.strategy === 'BARCODE' ? -1 : 1) ||
      right.plannedQuantity - left.plannedQuantity ||
      compareText(left.barcodes.join('|'), right.barcodes.join('|')),
  );
  const palletStates = new Map<string, { label: string; boxCount: number }>();
  const warehouseBoxCounters = new Map<string, number>();
  const warehousePalletCounters = new Map<string, number>();
  const assignedPhysicalBoxes = new Map<string, Set<string>>();

  return sortedDrafts.map((draft) => {
    const boxNumber = (warehouseBoxCounters.get(draft.warehouseId) ?? 0) + 1;
    warehouseBoxCounters.set(draft.warehouseId, boxNumber);

    const palletKey = `${draft.warehouseId}:${draft.articleKey}`;
    let palletState = palletStates.get(palletKey);
    if (!palletState || palletState.boxCount >= STORAGE_PALLET_MAX_BOXES) {
      const palletNumber = (warehousePalletCounters.get(draft.warehouseId) ?? 0) + 1;
      warehousePalletCounters.set(draft.warehouseId, palletNumber);
      palletState = {
        label: `Паллетсорт ${pad(palletNumber)} · ${draft.article}`,
        boxCount: 0,
      };
      palletStates.set(palletKey, palletState);
    }
    // FIX: a proposed pallet sort never contains more than 20 boxes.
    palletState.boxCount += 1;
    const targetPalletSort = palletState.label;

    const assigned = assignedPhysicalBoxes.get(draft.warehouseId) ?? new Set<string>();
    assignedPhysicalBoxes.set(draft.warehouseId, assigned);
    const physicalBoxCode = choosePhysicalBox(draft.allocations, assigned);
    if (physicalBoxCode) assigned.add(physicalBoxCode);

    const target: StorageOptimizationTargetBox = {
      id: `${draft.warehouseId}:BOX:${boxNumber}`,
      label: `Короб ${pad(boxNumber)}${physicalBoxCode ? ` · ${physicalBoxCode}` : ' · НОВЫЙ'}`,
      physicalBoxCode,
      warehouseId: draft.warehouseId,
      warehouseName: draft.warehouseName,
      strategy: draft.strategy,
      article: draft.article,
      colors: draft.colors,
      sizes: draft.sizes,
      barcodes: draft.barcodes,
      plannedQuantity: draft.plannedQuantity,
      targetPalletSort,
    };
    return { target, allocations: draft.allocations };
  });
}

function choosePhysicalBox(allocations: Allocation[], assigned: Set<string>) {
  const overlap = new Map<string, number>();
  for (const allocation of allocations) {
    overlap.set(allocation.source.sourceBox, (overlap.get(allocation.source.sourceBox) ?? 0) + allocation.quantity);
  }
  return (
    [...overlap.entries()]
      .filter(([box]) => !assigned.has(box))
      .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))[0]?.[0] ?? null
  );
}

function takeFromQueue(queue: NormalizedSourceRow[], requested: number): Allocation[] {
  let remaining = requested;
  const allocations: Allocation[] = [];
  for (const source of queue) {
    if (remaining <= 0) break;
    const quantity = Math.min(source.quantity, remaining);
    if (quantity <= 0) continue;
    allocations.push({ source: { ...source }, quantity });
    source.quantity -= quantity;
    remaining -= quantity;
  }
  if (remaining !== 0) throw new Error(`Не удалось распределить ${requested} ед. товара.`);
  return allocations;
}

function distributeQuantity(total: number, boxes: number) {
  if (boxes <= 0 || total <= 0) return [];
  const base = Math.floor(total / boxes);
  const extra = total % boxes;
  return Array.from({ length: boxes }, (_, index) => base + (index < extra ? 1 : 0));
}

function splitByMaximum(total: number) {
  if (total <= 0) return [];
  return distributeQuantity(total, Math.ceil(total / STORAGE_BOX_MAX_QUANTITY));
}

function groupValues<T>(values: T[], keyOf: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([, group]) => group);
}

function countBy<T>(values: T[], keyOf: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function cloneRows(rows: NormalizedSourceRow[]) {
  return rows.map((row) => ({ ...row }));
}

function sumQuantity(rows: Array<{ quantity: number }>) {
  return rows.reduce((sum, row) => sum + row.quantity, 0);
}

function uniqueSorted(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(compareText);
}

function compareSourceRows(left: NormalizedSourceRow, right: NormalizedSourceRow) {
  return (
    compareText(left.warehouseName, right.warehouseName) ||
    compareText(left.articleKey, right.articleKey) ||
    compareText(left.barcodeKey, right.barcodeKey) ||
    compareText(left.sourcePalletSort, right.sourcePalletSort) ||
    compareText(left.sourceBox, right.sourceBox) ||
    compareText(left.skuId, right.skuId)
  );
}

function compareText(left?: string | null, right?: string | null) {
  return (left ?? '').localeCompare(right ?? '', 'ru');
}

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized || null;
}

function pad(value: number) {
  return String(value).padStart(3, '0');
}
