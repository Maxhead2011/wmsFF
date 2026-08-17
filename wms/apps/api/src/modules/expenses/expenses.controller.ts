import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import {
  AddExpenseMaterialStockDto,
  CreateExpenseEntryDto,
  CreateExpenseMaterialDto,
  ListExpensesDto,
  UpdateExpenseMaterialDto,
  UpdateExpensePayrollRateDto,
  UpsertClientExpenseMaterialRuleDto,
} from './dto/expenses.dto';
import {
  buildExpenseReportWorkbook,
  expenseReportXlsxMimeType,
} from './expense-report-xlsx';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@RequirePermissions('expenses:read')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('entries')
  listEntries(@Query() query: ListExpensesDto, @CurrentUser() user: AuthUser) {
    return this.expenses.listEntries(query, user);
  }

  @Post('entries')
  @RequirePermissions('expenses:write')
  createEntry(
    @Body() dto: CreateExpenseEntryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.createEntry(dto, user);
  }

  @Patch('entries/:id/cancel')
  @RequirePermissions('expenses:write')
  cancelEntry(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.cancelEntry(id, user);
  }

  @Get('materials')
  listMaterials(@CurrentUser() user: AuthUser) {
    return this.expenses.listMaterials(user);
  }

  @Post('materials')
  @RequirePermissions('expenses:write')
  createMaterial(
    @Body() dto: CreateExpenseMaterialDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.createMaterial(dto, user);
  }

  @Patch('materials/:id')
  @RequirePermissions('expenses:write')
  updateMaterial(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseMaterialDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.updateMaterial(id, dto, user);
  }

  @Post('materials/:id/stock')
  @RequirePermissions('expenses:write')
  addMaterialStock(
    @Param('id') id: string,
    @Body() dto: AddExpenseMaterialStockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.addMaterialStock(id, dto, user);
  }

  @Get('materials/:id/movements')
  listMaterialMovements(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.listMaterialMovements(id, user);
  }

  @Get('clients/:clientId/material-rules')
  listClientMaterialRules(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.listClientMaterialRules(clientId, user);
  }

  @Put('clients/:clientId/material-rules/:materialId')
  @RequirePermissions('expenses:write')
  upsertClientMaterialRule(
    @Param('clientId') clientId: string,
    @Param('materialId') materialId: string,
    @Body() dto: UpsertClientExpenseMaterialRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.upsertClientMaterialRule(
      clientId,
      materialId,
      dto,
      user,
    );
  }

  @Get('report')
  getReport(@Query() query: ListExpensesDto, @CurrentUser() user: AuthUser) {
    return this.expenses.getReport(query, user);
  }

  @Get('payroll')
  getPayroll(@Query() query: ListExpensesDto, @CurrentUser() user: AuthUser) {
    return this.expenses.getPayroll(query, user);
  }

  @Put('payroll/users/:userId/rate')
  @RequirePermissions('expenses:write')
  updatePayrollRate(
    @Param('userId') userId: string,
    @Body() dto: UpdateExpensePayrollRateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.updatePayrollRate(userId, dto, user);
  }

  @Post('payroll/users/:userId/reset')
  @RequirePermissions('expenses:write')
  resetPayrollCounter(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.resetPayrollCounter(userId, user);
  }

  @Get('debts')
  getDebts(
    @Query('clientId') clientId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.getDebts(clientId, user);
  }

  @Get('report.xlsx')
  async getReportXlsx(
    @Query() query: ListExpensesDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const [report, debts] = await Promise.all([
      this.expenses.getReport(query, user),
      this.expenses.getDebts(query.clientId, user),
    ]);
    const fileName = `Расходы_${report.periodFrom.slice(0, 10)}_${report.periodTo.slice(0, 10)}.xlsx`;
    response.setHeader('Content-Type', expenseReportXlsxMimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="expenses.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    return new StreamableFile(buildExpenseReportWorkbook(report, debts));
  }
}
