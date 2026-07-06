import { BadRequestException, Injectable } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { InventoryScanPayload, MoveScanPayload, ReceiptScanPayload } from './tsd-operation.types';

@Injectable()
export class TsdPayloadParser {
  parseMovePayload(payload: Record<string, unknown>): MoveScanPayload {
    const clientId = this.stringValue(payload.clientId, 'clientId');
    const fromBoxCode = this.stringValue(payload.fromBoxCode, 'fromBoxCode');
    const toBoxCode = this.stringValue(payload.toBoxCode, 'toBoxCode');
    const quantity = this.numberValue(payload.quantity, 'quantity');
    const barcode = this.optionalStringValue(payload.barcode);
    const skuId = this.optionalStringValue(payload.skuId);

    if (!barcode && !skuId) {
      throw new BadRequestException('Для move_scan нужен barcode или skuId.');
    }

    return {
      clientId,
      barcode,
      skuId,
      fromBoxCode,
      toBoxCode,
      quantity,
      status: this.optionalStockStatus(payload.status),
      comment: this.optionalStringValue(payload.comment),
    };
  }

  parseReceiptPayload(payload: Record<string, unknown>): ReceiptScanPayload {
    const clientId = this.stringValue(payload.clientId, 'clientId');
    const boxCode = this.stringValue(payload.boxCode ?? payload.toBoxCode, 'boxCode');
    const quantity = this.numberValue(payload.quantity, 'quantity');
    const barcode = this.optionalStringValue(payload.barcode);
    const skuId = this.optionalStringValue(payload.skuId);
    const kiz = this.optionalStringValue(payload.kiz);

    if (!barcode && !skuId) {
      throw new BadRequestException('Для receipt_scan нужен barcode или skuId.');
    }

    return {
      clientId,
      barcode,
      skuId,
      kiz,
      boxCode,
      quantity,
      status: this.optionalStockStatus(payload.status),
      sourceDocument: this.optionalStringValue(payload.sourceDocument),
      comment: this.optionalStringValue(payload.comment),
    };
  }

  parseInventoryPayload(payload: Record<string, unknown>): InventoryScanPayload {
    const clientId = this.stringValue(payload.clientId, 'clientId');
    const boxCode = this.stringValue(payload.boxCode, 'boxCode');
    const countedQuantity = this.nonNegativeNumberValue(payload.countedQuantity ?? payload.quantity, 'countedQuantity');
    const barcode = this.optionalStringValue(payload.barcode);
    const skuId = this.optionalStringValue(payload.skuId);

    if (!barcode && !skuId) {
      throw new BadRequestException('Для inventory_scan нужен barcode или skuId.');
    }

    return {
      clientId,
      barcode,
      skuId,
      boxCode,
      countedQuantity,
      status: this.optionalStockStatus(payload.status),
    };
  }

  private stringValue(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`Поле ${field} обязательно для операции ТСД.`);
    }

    return value.trim();
  }

  private optionalStringValue(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private optionalStockStatus(value: unknown) {
    if (value == null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string' || !Object.values(StockStatus).includes(value as StockStatus)) {
      throw new BadRequestException('Некорректный stock status в операции ТСД.');
    }

    return value as StockStatus;
  }

  private numberValue(value: unknown, field: string) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`Поле ${field} должно быть положительным целым числом.`);
    }

    return parsed;
  }

  private nonNegativeNumberValue(value: unknown, field: string) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`Поле ${field} должно быть целым числом от 0.`);
    }

    return parsed;
  }
}
