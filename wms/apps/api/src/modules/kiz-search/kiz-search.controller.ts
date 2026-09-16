import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { KizSearchService } from './kiz-search.service';

export class KizSearchScanDto {
  @IsString() @MinLength(1) @MaxLength(150) boxCode!: string;
  @IsString() @MinLength(1) @MaxLength(512) kiz!: string;
}
// FIX: isolated endpoints confirm physical findings without stock movements.
@Controller('tsd/kiz-search')
export class KizSearchController {
  constructor(private readonly service: KizSearchService) {}
  @Get() @RequirePermissions('stock:read')
  list(@CurrentUser() user: AuthUser) { return this.service.list(user); }
  @Get(':id') @RequirePermissions('stock:read')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.get(id, user); }
  @Post(':id/scan') @RequirePermissions('stock:write')
  scan(@Param('id') id: string, @Body() dto: KizSearchScanDto, @CurrentUser() user: AuthUser) { return this.service.scan(id, dto, user); }
}
