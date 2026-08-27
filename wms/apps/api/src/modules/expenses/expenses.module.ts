import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ExpenseAutomationService } from './expense-automation.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseAutomationService],
  exports: [ExpensesService, ExpenseAutomationService],
})
export class ExpensesModule {}
