import { Body, Controller, Get, Headers, Put, Query } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import {
  ExternalFbsStockAllocationDto,
  ExternalFbsStocksDto,
} from './dto/fbs-stock-allocation.dto';
import { FbsStockAllocationService } from './fbs-stock-allocation.service';
import { MarketplaceConnectionsService } from './marketplace-connections.service';

@ApiTags('external-fbs-stocks')
@ApiHeader({ name: 'X-WMS-API-Key', required: true })
@Public()
@Controller('external/v1/fbs')
export class FbsStockAllocationExternalController {
  constructor(
    private readonly allocation: FbsStockAllocationService,
    private readonly connections: MarketplaceConnectionsService,
  ) {}

  // ADDED: A service-to-service API key is bound to one client and cannot select another clientId.
  @Get('stock-allocation')
  async getAllocation(
    @Headers('x-wms-api-key') apiKey: string | undefined,
    @Query('connectionId') connectionId: string,
  ) {
    const identity = await this.allocation.authenticateApiKey(apiKey);
    return this.connections.listExternalFbsStockAllocation(identity.clientId, connectionId);
  }

  @Put('stock-allocation')
  async updateAllocation(
    @Headers('x-wms-api-key') apiKey: string | undefined,
    @Body() dto: ExternalFbsStockAllocationDto,
  ) {
    const identity = await this.allocation.authenticateApiKey(apiKey);
    const saved = await this.allocation.saveExternal(identity.clientId, dto, identity.id);
    if (!saved.duplicate) {
      await this.connections.syncExternalFbsStockAllocation(identity.clientId, dto.connectionId);
    }
    return saved;
  }

  @Put('stocks')
  async updateStocks(
    @Headers('x-wms-api-key') apiKey: string | undefined,
    @Body() dto: ExternalFbsStocksDto,
  ) {
    const identity = await this.allocation.authenticateApiKey(apiKey);
    const saved = await this.allocation.saveExternalStockOverrides(
      identity.clientId,
      identity.id,
      dto,
    );
    if (!saved.duplicate) {
      await this.connections.syncExternalFbsStockAllocation(identity.clientId, dto.connectionId);
    }
    return saved;
  }
}
