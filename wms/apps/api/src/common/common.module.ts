import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit/audit-log.service';
import { ArchivedEmptyBoxPalletDetachService } from './boxes/archived-empty-box-pallet-detach.service';
import { BoxCodePolicyService } from './boxes/box-code-policy.service';
import { InventoryLockService } from './inventory/inventory-lock.service';
import { PrismaService } from './prisma/prisma.service';
import { SystemSettingsService } from './settings/system-settings.service';

@Global()
@Module({
  providers: [
    PrismaService,
    AuditLogService,
    InventoryLockService,
    SystemSettingsService,
    BoxCodePolicyService,
    // FIX: one canonical archived-empty rule is available to every stock workflow.
    ArchivedEmptyBoxPalletDetachService,
  ],
  exports: [
    PrismaService,
    AuditLogService,
    InventoryLockService,
    SystemSettingsService,
    BoxCodePolicyService,
    ArchivedEmptyBoxPalletDetachService,
  ],
})
export class CommonModule {}
