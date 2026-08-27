import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CreateIntegrationStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import {
  ListIntegrationDataDto,
  ListIntegrationRequestsDto,
  ListIntegrationStocksDto,
} from './dto/list-integration-data.dto';
import { IntegrationContext } from './integration-context.decorator';
import { IntegrationApiGuard } from './integration-api.guard';
import { IntegrationApiService } from './integration-api.service';
import type { WmsIntegrationContext } from './integration-api.types';
import {
  integrationAdjustmentSchema,
  integrationCatalogSchema,
  integrationMovementsSchema,
  integrationProfileSchema,
  integrationRequestsSchema,
  integrationStocksSchema,
} from './integration-api.swagger';

@Public()
@UseGuards(IntegrationApiGuard)
@ApiSecurity('WmsApiKey')
@ApiTags('WMS Integration API v1')
@ApiUnauthorizedResponse({ description: 'Ключ неверен, отозван, истёк или не разрешён для IP/склада.' })
@ApiForbiddenResponse({ description: 'API-ключу не выдан требуемый scope.' })
@Controller('integration/v1')
export class IntegrationApiController {
  constructor(private readonly service: IntegrationApiService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Проверить ключ и получить закреплённые клиента и склад' })
  @ApiOkResponse({ schema: integrationProfileSchema })
  profile(@IntegrationContext() context: WmsIntegrationContext) {
    return this.service.profile(context);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Справочник товаров клиента' })
  @ApiOkResponse({ schema: integrationCatalogSchema })
  catalog(@IntegrationContext() context: WmsIntegrationContext, @Query() query: ListIntegrationDataDto) {
    return this.service.catalog(context, query);
  }

  @Get('stocks')
  @ApiOperation({ summary: 'Остатки закреплённого клиента на закреплённом складе' })
  @ApiOkResponse({ schema: integrationStocksSchema })
  stocks(@IntegrationContext() context: WmsIntegrationContext, @Query() query: ListIntegrationStocksDto) {
    return this.service.stocks(context, query);
  }

  @Post('stock-adjustments')
  @ApiOperation({ summary: 'Установить фактический AVAILABLE-остаток через ledger WMS, с коробом или без него' })
  @ApiOkResponse({ schema: integrationAdjustmentSchema })
  adjustStock(
    @IntegrationContext() context: WmsIntegrationContext,
    @Body() dto: CreateIntegrationStockAdjustmentDto,
  ) {
    return this.service.adjustStock(context, dto);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Заявки закреплённого клиента и склада' })
  @ApiOkResponse({ schema: integrationRequestsSchema })
  requests(@IntegrationContext() context: WmsIntegrationContext, @Query() query: ListIntegrationRequestsDto) {
    return this.service.requests(context, query);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Ledger-движения товара закреплённого клиента и склада' })
  @ApiOkResponse({ schema: integrationMovementsSchema })
  movements(@IntegrationContext() context: WmsIntegrationContext, @Query() query: ListIntegrationDataDto) {
    return this.service.movements(context, query);
  }
}
