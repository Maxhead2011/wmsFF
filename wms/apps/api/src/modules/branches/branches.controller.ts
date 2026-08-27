import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../auth/decorators/require-permissions.decorator';
import { BranchesService } from './branches.service';

@Controller('branches')
@RequireAnyPermissions('warehouse:read', 'client-requests:write')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.branches.list(user);
  }

  @Post()
  @RequirePermissions('system:admin')
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.branches.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('system:admin')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.branches.update(id, body, user);
  }

  @Post(':id/activate')
  @RequirePermissions('warehouse:read')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.branches.activate(id, user);
  }

  @Put(':id/manager')
  @RequirePermissions('system:admin')
  assignManager(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.branches.assignManager(id, body, user);
  }

  @Get('stock-summary')
  @RequirePermissions('stock:read')
  stockSummary(@Query('clientId') clientId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.branches.stockSummary(clientId, user);
  }

  @Get('transfers')
  @RequirePermissions('stock:read')
  transfers(@Query('clientId') clientId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.branches.listTransfers(clientId, user);
  }

  @Post('transfers/boxes-xlsx/preview')
  @RequirePermissions('stock:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'XLSX, XLS или CSV со списком коробов. Поддерживаются колонки «Код короба», «Короб», «ШК короба» и одноколоночный список.',
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  previewTransferBoxesFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('clientId') clientId: string | undefined,
    @Query('fromWarehouseId') fromWarehouseId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.branches.previewTransferBoxesFile(
      file,
      clientId,
      fromWarehouseId,
      user,
    );
  }

  @Post('transfers')
  @RequirePermissions('stock:write')
  transfer(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.branches.transfer(body, user);
  }

  @Post('transfers/:id/receive-box')
  @RequirePermissions('stock:write')
  receiveBox(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.branches.receiveBox(id, body, user);
  }
}
