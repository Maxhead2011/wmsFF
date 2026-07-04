import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { BillingDocumentService } from './billing-document.service';
import { BillingPdfService } from './billing-pdf.service';
import { BillingService } from './billing.service';
import { CreateBillingChargeDto } from './dto/create-billing-charge.dto';
import { CreateBillingInvoiceDto } from './dto/create-billing-invoice.dto';
import { CreateBillingPaymentDto } from './dto/create-billing-payment.dto';
import { CreateBillingServiceDto } from './dto/create-billing-service.dto';
import { CreateManualBillingInvoiceDto } from './dto/create-manual-billing-invoice.dto';
import { GenerateStorageChargeDto } from './dto/generate-storage-charge.dto';
import { ListBillingChargesDto } from './dto/list-billing-charges.dto';
import { ListBillingInvoicesDto } from './dto/list-billing-invoices.dto';
import { ListBillingReconciliationDto } from './dto/list-billing-reconciliation.dto';
import { ListBillingServiceHistoryDto } from './dto/list-billing-service-history.dto';
import { UpdateBillingChargeStatusDto } from './dto/update-billing-charge-status.dto';
import { UpdateBillingInvoiceStatusDto } from './dto/update-billing-invoice-status.dto';
import { UpsertClientBillingServiceDto } from './dto/upsert-client-billing-service.dto';

@ApiTags('billing')
@RequirePermissions('billing:read')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly documents: BillingDocumentService,
    private readonly pdf: BillingPdfService,
  ) {}

  @Get('services')
  listServices() {
    return this.billing.listServices();
  }

  @Post('services')
  @RequirePermissions('billing:write')
  createService(@Body() dto: CreateBillingServiceDto, @CurrentUser() user: AuthUser) {
    return this.billing.createService(dto, user);
  }

  @Get('clients/:clientId/services')
  listClientServices(@Param('clientId') clientId: string, @CurrentUser() user: AuthUser) {
    return this.billing.listClientServices(clientId, user);
  }

  @Put('clients/:clientId/services')
  @RequirePermissions('billing:write')
  upsertClientService(
    @Param('clientId') clientId: string,
    @Body() dto: UpsertClientBillingServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.upsertClientService(clientId, dto, user);
  }

  @Get('charges')
  listCharges(@Query() query: ListBillingChargesDto, @CurrentUser() user: AuthUser) {
    return this.billing.listCharges(query, user);
  }

  @Get('service-history')
  listServiceHistory(@Query() query: ListBillingServiceHistoryDto, @CurrentUser() user: AuthUser) {
    return this.billing.listServiceHistory(query, user);
  }

  @Get('reconciliation')
  listReconciliation(@Query() query: ListBillingReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.billing.listReconciliation(query, user);
  }

  @Post('charges')
  @RequirePermissions('billing:write')
  createCharge(@Body() dto: CreateBillingChargeDto, @CurrentUser() user: AuthUser) {
    return this.billing.createCharge(dto, user);
  }

  @Post('charges/storage')
  @RequirePermissions('billing:write')
  generateStorageCharge(@Body() dto: GenerateStorageChargeDto, @CurrentUser() user: AuthUser) {
    return this.billing.generateStorageCharge(dto, user);
  }

  @Patch('charges/:id/status')
  @RequirePermissions('billing:write')
  updateChargeStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBillingChargeStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.updateChargeStatus(id, dto, user);
  }

  @Get('charges/:id/storage-breakdown')
  getStorageChargeBreakdown(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.billing.getStorageChargeBreakdown(id, user);
  }

  @Delete('charges/:id/storage-breakdown/:date')
  @RequirePermissions('billing:write')
  deleteStorageChargeDay(@Param('id') id: string, @Param('date') date: string, @CurrentUser() user: AuthUser) {
    return this.billing.deleteStorageChargeDay(id, date, user);
  }

  @Get('invoices')
  listInvoices(@Query() query: ListBillingInvoicesDto, @CurrentUser() user: AuthUser) {
    return this.billing.listInvoices(query, user);
  }

  @Get('invoices/:id/document')
  getInvoiceDocument(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documents.getInvoiceDocument(id, user);
  }

  @Get('invoices/:id/document.pdf')
  async getInvoiceDocumentPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.pdf.getInvoicePdf(id, user);
    setPdfHeaders(response, file.fileName);
    return new StreamableFile(file.buffer);
  }

  @Get('invoices/:id/act')
  getInvoiceActDocument(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documents.getInvoiceActDocument(id, user);
  }

  @Get('invoices/:id/act.pdf')
  async getInvoiceActDocumentPdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.pdf.getInvoiceActPdf(id, user);
    setPdfHeaders(response, file.fileName);
    return new StreamableFile(file.buffer);
  }

  @Post('invoices')
  @RequirePermissions('billing:write')
  createInvoice(@Body() dto: CreateBillingInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.billing.createInvoice(dto, user);
  }

  @Post('invoices/manual')
  @RequirePermissions('billing:write')
  createManualInvoice(@Body() dto: CreateManualBillingInvoiceDto, @CurrentUser() user: AuthUser) {
    return this.billing.createManualInvoice(dto, user);
  }

  @Post('requests/:id/issue')
  @RequirePermissions('billing:write')
  issueRequestInvoice(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.billing.issueRequestInvoices(id, user);
  }

  @Patch('invoices/:id/status')
  @RequirePermissions('billing:write')
  updateInvoiceStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBillingInvoiceStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.updateInvoiceStatus(id, dto, user);
  }

  @Post('payments')
  @RequirePermissions('billing:write')
  createPayment(@Body() dto: CreateBillingPaymentDto, @CurrentUser() user: AuthUser) {
    return this.billing.createPayment(dto, user);
  }
}

function setPdfHeaders(response: Response, fileName: string) {
  const asciiName = fileName.replace(/[^\w.-]+/g, '_');
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
}
