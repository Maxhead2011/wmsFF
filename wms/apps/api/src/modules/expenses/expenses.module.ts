import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ExpenseAutomationService } from './expense-automation.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports: [AuthModule, BillingModule],
  controllers: [ExpensesController, PayrollController],
  providers: [ExpensesService, ExpenseAutomationService, PayrollService],
  exports: [ExpensesService, ExpenseAutomationService],
})
export class ExpensesModule {}
