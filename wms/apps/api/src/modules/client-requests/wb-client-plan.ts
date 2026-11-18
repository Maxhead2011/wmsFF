import { BadRequestException } from '@nestjs/common';
import type { CreateClientRequestDto } from './dto/create-client-request.dto';

// FIX: accepting a client plan changes demand only; it never supplies missing stock.
export function isWbClientPlan(dto: CreateClientRequestDto): boolean {
  if (!dto.fboFormationMode) return false;
  if (dto.fboFormationMode !== 'WB_CLIENT_PLAN' ||
      process.env.WMS_FBO_EXCEL_PICK_CHECK_ENABLED !== 'true' ||
      dto.fboExcel !== true || dto.type !== 'OUTBOUND') {
    throw new BadRequestException('Формирование по заявке клиента недоступно для этой операции.');
  }
  if (!dto.items?.length || dto.items.some(item => !item.skuId?.trim() ||
      !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    throw new BadRequestException('Укажите найденные товары и положительные целые количества.');
  }
  return true;
}
