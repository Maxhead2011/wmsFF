import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { OwnCompaniesModule } from '../own-companies/own-companies.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [AuthModule, CommonModule, OwnCompaniesModule],
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}
