import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateReturnBatchDto, ScanReturnDto, MarkReturnDto, CloseReturnBoxDto } from './returns.dto';
import { ReturnsService } from './returns.service';

@Controller('returns')
@RequirePermissions('stock:read')
export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}
  @Get() list(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.list(clientId, user); }
  @Post() @RequirePermissions('stock:write') create(@Body() dto: CreateReturnBatchDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
  @Post(':id/scan') @RequirePermissions('stock:write') scan(@Param('id') id: string, @Body() dto: ScanReturnDto, @CurrentUser() user: AuthUser) { return this.service.scan(id, dto, user); }
  @Post(':id/finish') @RequirePermissions('stock:write') finish(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.finish(id, user); }
  @Get('box') findBox(@Query('clientId') clientId: string, @Query('boxCode') boxCode: string, @CurrentUser() user: AuthUser) { return this.service.findBox(clientId, boxCode ?? '', user); }
  @Post(':id/mark') @RequirePermissions('stock:write') mark(@Param('id') id: string, @Body() dto: MarkReturnDto, @CurrentUser() user: AuthUser) { return this.service.mark(id, dto, user); }
  @Post(':id/close-box') @RequirePermissions('stock:write') closeBox(@Param('id') id: string, @Body() dto: CloseReturnBoxDto, @CurrentUser() user: AuthUser) { return this.service.closeBox(id, dto.boxCode, user); }
  @Get(':id/export.xlsx') async export(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const data = await this.service.export(id, user);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', 'attachment; filename="returns.xlsx"');
    response.send(data);
  }
}
