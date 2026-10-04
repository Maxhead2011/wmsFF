import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { FboProcessingPricingService } from './fbo-processing-pricing.service';
import { CreateFboProcessingTariffDto } from './dto/fbo-processing-pricing.dto';
// FIX: no update/delete route can overwrite an existing client's conditions.
@Controller('billing/fbo-processing')
@RequirePermissions('billing:read')
export class FboProcessingPricingController {
    constructor(private readonly pricing: FboProcessingPricingService) { }
    @Get()
    list(
    @CurrentUser()
    user: AuthUser) { return this.pricing.list(user); }
    @Get(':clientId/products')
    products(
    @Param('clientId')
    clientId: string,
    @Query('search')
    search = '',
    @CurrentUser()
    user: AuthUser) { return this.pricing.products(clientId, search, user); }
    @Post(':clientId')
    @RequirePermissions('billing:write')
    create(
    @Param('clientId')
    clientId: string,
    @Body()
    dto: CreateFboProcessingTariffDto,
    @CurrentUser()
    user: AuthUser) { return this.pricing.create(clientId, dto, user); }
}
