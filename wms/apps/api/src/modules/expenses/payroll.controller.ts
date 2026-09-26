import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { payrollPdf, payrollXlsx } from './payroll-export';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PayrollConditionDto, PayrollEmployeeDto, PayrollHandlingDto, PayrollShiftDto, PayrollStatusDto, PayrollHistoryEditDto } from './payroll.dto';
import { PayrollService } from './payroll.service';

@Controller('expenses/workforce')
@RequirePermissions('expenses:read')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) {
    return { enabled: process.env.WMS_PAYROLL_ATTENDANCE_ENABLED === 'true' && user.roleCodes.some(r => ['ADMIN', 'OWNER'].includes(r)) };
  }
  @Get('employees') employees(@CurrentUser() user: AuthUser) { return this.payroll.employees(user); }
  @Get('picking-users') users(@CurrentUser() user: AuthUser) { return this.payroll.pickingUsers(user); }
  @Post('employees') @RequirePermissions('expenses:write')
  create(@Body() dto: PayrollEmployeeDto, @CurrentUser() user: AuthUser) { return this.payroll.saveEmployee(undefined, dto, user); }
  @Put('employees/:id') @RequirePermissions('expenses:write')
  update(@Param('id') id: string, @Body() dto: PayrollEmployeeDto, @CurrentUser() user: AuthUser) { return this.payroll.saveEmployee(id, dto, user); }
  @Post('employees/:id/conditions') @RequirePermissions('expenses:write')
  condition(@Param('id') id: string, @Body() dto: PayrollConditionDto, @CurrentUser() user: AuthUser) { return this.payroll.addCondition(id, dto, user); }
  @Post('employees/:id/shifts') @RequirePermissions('expenses:write')
  shift(@Param('id') id: string, @Body() dto: PayrollShiftDto, @CurrentUser() user: AuthUser) { return this.payroll.addShift(id, dto, user); }
  @Get('employees/:id/shifts')
  shifts(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.payroll.shifts(id, user); }
  @Put('employees/:id/shifts/:shiftId') @RequirePermissions('expenses:write')
  updateShift(@Param('id') id: string, @Param('shiftId') shiftId: string, @Body() dto: PayrollShiftDto, @CurrentUser() user: AuthUser) { return this.payroll.updateShift(id, shiftId, dto, user); }
  @Get('employees/:id/report') report(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string, @CurrentUser() user: AuthUser) {
    return this.payroll.report(id, from, to, user);
  }
  @Put('employees/:id/history/:key') @RequirePermissions('expenses:write')
  updateHistory(@Param('id') id: string, @Param('key') key: string, @Body() dto: PayrollHistoryEditDto, @CurrentUser() user: AuthUser) {
    return this.payroll.updateHistory(id, key, dto, user);
  }
  @Post('handling') @RequirePermissions('expenses:write')
  handling(@Body() dto: PayrollHandlingDto, @CurrentUser() user: AuthUser) { return this.payroll.addHandling(dto, user); }
  @Post('handling/:id/confirm') @RequirePermissions('expenses:write')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.payroll.confirmHandling(id, user); }
  @Post('statuses') @RequirePermissions('expenses:write')
  status(@Body() dto: PayrollStatusDto, @CurrentUser() user: AuthUser) { return this.payroll.setStatus(dto, user); }
  @Get('employees/:id/export')
  async export(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string, @Query('format') format: string, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) response: Response) {
    const report = await this.payroll.report(id, from, to, user);
    const pdf = format === 'pdf';
    response.setHeader('Content-Type', pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="payroll.${pdf ? 'pdf' : 'xlsx'}"`);
    return new StreamableFile(pdf ? await payrollPdf(report) : payrollXlsx(report));
  }
  @Post('import') @RequirePermissions('expenses:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async import(@UploadedFile() file: Express.Multer.File, @Body('mapping') mapping: string | undefined, @CurrentUser() user: AuthUser) {
    if (!file?.buffer) throw new BadRequestException('Выберите XLSX-файл.');
    if (!mapping) return this.payroll.previewImport(file.buffer, user);
    let parsed: Record<string, string>;
    try { parsed = JSON.parse(mapping); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); }
    catch { throw new BadRequestException('Некорректное соответствие сотрудников.'); }
    return this.payroll.importHistory(file.buffer, parsed, user);
  }
}
