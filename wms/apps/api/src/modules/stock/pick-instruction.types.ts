import { ClientRequestPriority, ClientRequestStatus } from '@prisma/client';

export type PickInstructionAllocation = {
  balanceId: string;
  boxId: string;
  boxCode: string;
  palletId: string | null;
  palletCode: string | null;
  quantity: number;
};

export type PickInstructionRowStatus = 'READY' | 'SHORTAGE' | 'SKU_NOT_FOUND';

export type PickInstructionRow = {
  position: number;
  itemId: string;
  skuId: string | null;
  internalSku: string | null;
  name: string | null;
  barcode: string | null;
  requestedQuantity: number;
  allocatedQuantity: number;
  shortageQuantity: number;
  status: PickInstructionRowStatus;
  statusLabel: string;
  comment: string | null;
  allocations: PickInstructionAllocation[];
};

export type PickInstructionBoxSummary = {
  boxId: string;
  boxCode: string;
  palletId: string | null;
  palletCode: string | null;
  allocatedQuantity: number;
  availableQuantity: number;
  linesCount: number;
  isFullBox: boolean;
  comment: string;
};

export type WarehouseInstructionRow = {
  orderId?: string;
  city: string;
  sourceBox: string;
  targetBox: string;
  pallet: string;
  artOnBox: string;
  barcodeOnBox: string;
  size: string;
  quantity: number;
  comment: string;
  rebrandNote: string;
  note: string;
};

export type WarehouseWholeBoxRow = {
  box: string;
  status: string;
  city: string;
  pallet: string;
  balanceBox: string;
};

export type WarehouseBalanceMoveRow = {
  orderId?: string;
  sourceBox: string;
  newBox: string;
  purpose: 'BALANCE' | 'SHIPMENT';
  targetRole: 'STOCK' | 'SHIPMENT';
  pallet: string;
  artOnBox: string;
  barcodeOnBox: string;
  size: string;
  quantity: number;
  note: string;
};

export type WarehouseBalanceLabelRow = {
  newBox: string;
  sourceBox: string;
  tspl: string;
};

export type WarehouseMarkRow = {
  orderId?: string;
  comment: string;
  city: string;
  sourceBox: string;
  brand: string;
  ip: string;
  name: string;
  article: string;
  wbArticle: string;
  color: string;
  size: string;
  barcode: string;
  quantity: number;
};

export type PickInstructionDocument = {
  requestId: string;
  title: string;
  fileName: string;
  requestTitle: string;
  requestStatus: ClientRequestStatus;
  requestStatusLabel: string;
  priority: ClientRequestPriority;
  priorityLabel: string;
  client: {
    id: string;
    code: string;
    name: string;
  };
  generatedAt: string;
  desiredDate: string | null;
  destinationCity: string | null;
  deliveryAddress: string | null;
  totalRequested: number;
  totalAllocated: number;
  totalShortage: number;
  rowsCount: number;
  readyRowsCount: number;
  shortageRowsCount: number;
  boxesCount: number;
  fullBoxesCount: number;
  rows: PickInstructionRow[];
  boxes: PickInstructionBoxSummary[];
  warehouseRows: WarehouseInstructionRow[];
  warehouseWholeBoxes: WarehouseWholeBoxRow[];
  warehouseBalanceMoves: WarehouseBalanceMoveRow[];
  warehouseBalanceLabels: WarehouseBalanceLabelRow[];
  warehouseMarkRows: WarehouseMarkRow[];
  instructionSource: 'AUTOMATIC' | 'MANUAL';
  manualInstructionFileName: string | null;
  manualInstructionUploadedAt: string | null;
};
