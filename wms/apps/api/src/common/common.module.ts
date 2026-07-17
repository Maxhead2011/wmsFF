import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit/audit-log.service';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [PrismaService, AuditLogService],
  exports: [PrismaService, AuditLogService],
})
export class CommonModule {}
