import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit/audit-log.service';
import { InventoryLockService } from './inventory/inventory-lock.service';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [PrismaService, AuditLogService, InventoryLockService],
  exports: [PrismaService, AuditLogService, InventoryLockService],
})
export class CommonModule {}
