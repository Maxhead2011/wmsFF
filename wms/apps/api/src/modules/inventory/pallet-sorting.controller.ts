import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PalletSortingService } from './pallet-sorting.service';
import { PalletSortingActionDto, StartPalletSortingDto } from './dto/pallet-sorting.dto';

// ADDED: web and TSD share the same authorized, idempotent workflow.
@ApiTags('pallet-sorting')
@Controller('pallet-sorting')
@RequirePermissions('stock:write')
export class PalletSortingController {
  constructor(private readonly sorting: PalletSortingService) {}
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) { return this.sorting.capabilities(user); }
  @Get() list(@CurrentUser() user: AuthUser) { return this.sorting.list(user); }
  @Post() start(@Body() dto: StartPalletSortingDto, @CurrentUser() user: AuthUser) { return this.sorting.start(dto, user); }
  @Get(':id') get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.sorting.get(id, user); }
  @Get(':id/preview') preview(@Param('id') id: string, @Query('kind') kind: string, @CurrentUser() user: AuthUser) {
    return this.sorting.preview(id, kind === 'missing' ? 'missing' : 'remaining', user);
  }
  @Post(':id/actions') action(@Param('id') id: string, @Body() dto: PalletSortingActionDto, @CurrentUser() user: AuthUser) { return this.sorting.action(id, dto, user); }
  @Post(':id/routes') routes(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.sorting.rebuildRoutes(id, user); }
}
