import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AssignDeliveryTripDto } from './dto/assign-delivery-trip.dto';
import { CreateDeliveryRequestDto } from './dto/create-delivery-request.dto';
import { CreateLogisticsCarrierDto } from './dto/create-logistics-carrier.dto';
import { CreateLogisticsTripDto } from './dto/create-logistics-trip.dto';
import { FinalizeDeliveryQuoteDto } from './dto/finalize-delivery-quote.dto';
import { ListDeliveryRequestsDto } from './dto/list-delivery-requests.dto';
import { ListLogisticsTripsDto } from './dto/list-logistics-trips.dto';
import { QuoteLogisticsDto } from './dto/quote-logistics.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { UpdateLogisticsTripStatusDto } from './dto/update-logistics-trip-status.dto';
import { LogisticsService } from './logistics.service';

@ApiTags('logistics')
@RequirePermissions('logistics:read')
@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get('tariff-sets')
  listTariffSets() {
    return this.logistics.listTariffSets();
  }

  @Get('tariff-sets/:id')
  getTariffSet(@Param('id') id: string) {
    return this.logistics.getTariffSet(id);
  }

  @Get('destinations')
  @RequirePermissions('client-requests:write')
  listDestinationSuggestions(@Query('search') search?: string, @Query('tariffSetId') tariffSetId?: string) {
    return this.logistics.listDestinationSuggestions({ search, tariffSetId });
  }

  @Post('quote')
  quote(@Body() dto: QuoteLogisticsDto) {
    return this.logistics.quote(dto);
  }

  @Get('carriers')
  listCarriers(@CurrentUser() user: AuthUser) {
    return this.logistics.listCarriers(user);
  }

  @Post('carriers')
  @RequirePermissions('logistics:write')
  createCarrier(@Body() dto: CreateLogisticsCarrierDto, @CurrentUser() user: AuthUser) {
    return this.logistics.createCarrier(dto, user);
  }

  @Get('trips')
  listTrips(@Query() query: ListLogisticsTripsDto, @CurrentUser() user: AuthUser) {
    return this.logistics.listTrips(query, user);
  }

  @Post('trips')
  @RequirePermissions('logistics:write')
  createTrip(@Body() dto: CreateLogisticsTripDto, @CurrentUser() user: AuthUser) {
    return this.logistics.createTrip(dto, user);
  }

  @Patch('trips/:id/status')
  @RequirePermissions('logistics:write')
  updateTripStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLogisticsTripStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logistics.updateTripStatus(id, dto, user);
  }

  @Get('delivery-requests')
  listDeliveryRequests(@Query() query: ListDeliveryRequestsDto, @CurrentUser() user: AuthUser) {
    return this.logistics.listDeliveryRequests(query, user);
  }

  @Post('delivery-requests')
  @RequirePermissions('logistics:request')
  createDeliveryRequest(@Body() dto: CreateDeliveryRequestDto, @CurrentUser() user: AuthUser) {
    return this.logistics.createDeliveryRequest(dto, user);
  }

  @Patch('delivery-requests/:id/status')
  @RequirePermissions('logistics:write')
  updateDeliveryStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logistics.updateDeliveryStatus(id, dto, user);
  }

  @Patch('delivery-requests/:id/quote')
  @RequirePermissions('logistics:write')
  finalizeDeliveryQuote(
    @Param('id') id: string,
    @Body() dto: FinalizeDeliveryQuoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logistics.finalizeDeliveryQuote(id, dto, user);
  }

  @Post('delivery-requests/:id/billing-charge')
  @RequirePermissions('logistics:write', 'billing:write')
  generateDeliveryBillingCharge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.logistics.generateDeliveryBillingCharge(id, user);
  }

  @Patch('delivery-requests/:id/trip')
  @RequirePermissions('logistics:write')
  assignDeliveryTrip(
    @Param('id') id: string,
    @Body() dto: AssignDeliveryTripDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logistics.assignDeliveryTrip(id, dto, user);
  }
}
