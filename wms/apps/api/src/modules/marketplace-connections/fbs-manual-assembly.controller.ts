import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateFbsManualAssemblyDto, PreviewFbsManualAssemblyDto } from './dto/fbs-manual-assembly.dto';
import { FbsManualAssemblyService } from './fbs-manual-assembly.service';

@Controller('service/fbs-manual-assembly')
@RequirePermissions('clients:write')
export class FbsManualAssemblyController {
  constructor(private readonly service: FbsManualAssemblyService) {}
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) { return this.service.capabilities(user); }
  @Get('options') options(@Query('clientId') clientId: string, @CurrentUser() user: AuthUser) { return this.service.options(clientId, user); }
  @Post('preview') preview(@Body() dto: PreviewFbsManualAssemblyDto, @CurrentUser() user: AuthUser) { return this.service.preview(dto, user); }
  @Post('create') create(@Body() dto: CreateFbsManualAssemblyDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
}
