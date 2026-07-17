import { BadRequestException, Injectable } from '@nestjs/common';
import { StockStatus } from '@prisma/client';
import { InventoryScanPayload, MoveScanPayload, ReceiptScanPayload } from './tsd-operation.types';

@Injectable()
export class TsdPayloadParser {
  parseMovePayload(payload: Record<string, unknown>): MoveScanPayload {
    const clientId = this.stringValue(payload.clientId, 'clientId');
    const fromBoxCode = this.boxCodeValue(payload.fromBoxCode, 'fromBoxCode');
    const toBoxCode = this.boxCodeValue(payload.toBoxCode, 'toBoxCode');
    const quantity = this.numberValue(payload.quantity, 'quantity');
    const barcode = this.productBarcodeValue(payload.barcode);
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
    const boxCode = this.optionalBoxCodeValue(payload.boxCode ?? payload.toBoxCode);
    const quantity = this.numberValue(payload.quantity, 'quantity');
    const barcode = this.productBarcodeValue(payload.barcode);
    const skuId = this.optionalStringValue(payload.skuId);
    const kiz = this.kizValue(payload.kiz);

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
    const boxCode = this.boxCodeValue(payload.boxCode, 'boxCode');
    const countedQuantity = this.nonNegativeNumberValue(payload.countedQuantity ?? payload.quantity, 'countedQuantity');
    const barcode = this.productBarcodeValue(payload.barcode);
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

  private boxCodeValue(value: unknown, field: string) {
    const result = this.stringValue(value, field);
    if (!isFflBoxCode(result)) {
      throw new BadRequestException('Номер короба должен начинаться с FFL. Отсканируйте корректный ШК короба.');
    }
    return result.trim();
  }

  private optionalBoxCodeValue(value: unknown) {
    const result = this.optionalStringValue(value);
    if (!result) {
      return undefined;
    }
    if (!isFflBoxCode(result)) {
      throw new BadRequestException('Номер короба должен начинаться с FFL. Отсканируйте корректный ШК короба.');
    }
    return result;
  }

  private productBarcodeValue(value: unknown) {
    const result = this.optionalStringValue(value);
    if (!result) {
      return undefined;
    }
    if (isFflBoxCode(result)) {
      throw new BadRequestException('В поле ШК товара отсканирован номер короба. Отсканируйте ШК товара.');
    }
    if (result.length > 13) {
      throw new BadRequestException('ШК товара не должен быть длиннее 13 символов. Возможно, отсканирован КИЗ.');
    }
    return result;
  }

  private kizValue(value: unknown) {
    const result = this.optionalStringValue(value);
    if (!result) {
      return undefined;
    }
    if (isFflBoxCode(result)) {
      throw new BadRequestException('В поле КИЗ отсканирован номер короба. Отсканируйте КИЗ товара.');
    }
    if (result.length <= 20) {
      throw new BadRequestException('КИЗ должен быть длиннее 20 символов. Возможно, отсканирован ШК товара.');
    }
    return result;
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

function isFflBoxCode(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU').startsWith('FFL');
}
