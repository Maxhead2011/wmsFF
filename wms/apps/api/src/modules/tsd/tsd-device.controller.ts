import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTsdDeviceDto } from './dto/create-tsd-device.dto';
import { LoginTsdDeviceDto } from './dto/login-tsd-device.dto';
import { TsdAssemblyService } from './tsd-assembly.service';
import { TsdDeviceService } from './tsd-device.service';

@ApiTags('tsd')
@Controller('tsd')
export class TsdDeviceController {
  constructor(
    private readonly devices: TsdDeviceService,
    private readonly assembly: TsdAssemblyService,
  ) {}

  @Get('clients')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listClients(@CurrentUser() user: AuthUser) {
    return this.devices.listClientsForDevice(user);
  }

  @Get('requests')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listAssemblyRequests(@CurrentUser() user: AuthUser) {
    return this.assembly.listActiveRequests(user);
  }

  @Get('requests/active')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listActiveAssemblyRequests(@CurrentUser() user: AuthUser) {
    return this.assembly.listActiveRequests(user);
  }

  @Get('requests/:id')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getAssemblyRequest(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestPlan(id, user);
  }

  @Get('requests/:id/box-search')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getBoxSearch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'box-search', user);
  }

  @Post('requests/:id/box-search/scan')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/box-search/scan')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByGet(@Param('id') id: string, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query), user);
  }

  @Post('requests/:id/box-search/scan/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByPostPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(body, query, { code }), user);
  }

  @Get('requests/:id/box-search/scan/:code')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxSearchByGetPath(
    @Param('id') id: string,
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'box-search', 'scan', mergeActionPayload(undefined, query, { code }), user);
  }

  @Get('requests/:id/relabel')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getRelabel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'relabel', user);
  }

  @Post('requests/:id/relabel/scan-source')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanRelabelSource(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'relabel', 'scan-source', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/relabel/scan-target')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanRelabelTarget(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'relabel', 'scan-target', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/moves')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getMoves(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'moves', user);
  }

  @Post('requests/:id/moves/target-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanMoveTargetBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'target-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/moves/scan-item')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanMoveItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'scan-item', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/moves/finish')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  finishMoves(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'moves', 'finish', mergeActionPayload(body, query), user);
  }

  @Get('requests/:id/boxless-packing')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  getBoxlessPacking(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.assembly.getRequestStage(id, 'boxless-packing', user);
  }

  @Post('requests/:id/boxless-packing/open-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  openBoxlessBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'open-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/scan-item')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  scanBoxlessItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'scan-item', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/close-box')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  closeBoxlessBox(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'close-box', mergeActionPayload(body, query), user);
  }

  @Post('requests/:id/boxless-packing/finish')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  finishBoxlessPacking(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.handleStageAction(id, 'boxless-packing', 'finish', mergeActionPayload(body, query), user);
  }

  @Get('sku-by-barcode')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  findSkuByBarcode(
    @Query('clientId') clientId: string | undefined,
    @Query('barcode') barcode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assembly.findSkuByBarcode({ clientId, barcode }, user);
  }

  @Get('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:read')
  listDevices() {
    return this.devices.listDevices();
  }

  @Post('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:write')
  createDevice(@Body() dto: CreateTsdDeviceDto) {
    return this.devices.createDevice(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginTsdDeviceDto) {
    return this.devices.login(dto);
  }
}

function mergeActionPayload(
  body: unknown,
  query: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined = undefined,
) {
  const payload: Record<string, unknown> = {
    ...(query ?? {}),
    ...(extra ?? {}),
  };

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      ...payload,
      ...(body as Record<string, unknown>),
    };
  }

  if (typeof body === 'string' && body.trim()) {
    return {
      ...payload,
      scan: body.trim(),
    };
  }

  return payload;
}
