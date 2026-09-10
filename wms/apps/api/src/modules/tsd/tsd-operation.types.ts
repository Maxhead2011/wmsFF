import { StockStatus, TsdReviewReason } from '@prisma/client';
import { ScanOperationDto } from './dto/scan-operation.dto';

export type TsdOperationResult = {
  operationKey: string;
  operationType: ScanOperationDto['operationType'];
  // FIX: receipt_close may wait for its own scans without caching a terminal failure.
  status: 'ACCEPTED' | 'APPLIED' | 'ALREADY_APPLIED' | 'NEEDS_REVIEW' | 'REJECTED' | 'RETRY';
  message?: string;
  reviewReason?: TsdReviewReason;
  resolutionMessage?: string;
  serverTime: string;
};

export type MoveScanPayload = {
  clientId: string;
  barcode?: string;
  skuId?: string;
  fromBoxCode: string;
  toBoxCode: string;
  quantity: number;
  status?: StockStatus;
  comment?: string;
};

export type ReceiptScanPayload = {
  clientId: string;
  barcode?: string;
  skuId?: string;
  kiz?: string;
  boxCode?: string;
  receiptMode?: 'STANDARD' | 'BOXES';
  quantity: number;
  status?: StockStatus;
  sourceDocument?: string;
  comment?: string;
};

export type InventoryScanPayload = {
  clientId: string;
  barcode?: string;
  skuId?: string;
  boxCode: string;
  countedQuantity: number;
  status?: StockStatus;
};
