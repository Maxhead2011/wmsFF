import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateFbsRepeatAssemblyDto, PreviewFbsRepeatAssemblyDto } from './dto/fbs-repeat-assembly.dto';
import { FbsRepeatAssemblyService } from './fbs-repeat-assembly.service';

@Controller(['marketplace-connections/fbs/repeat-assembly', 'marketplace-connection/fbs/repeat-assembly'])
@RequirePermissions('clients:write')
export class FbsRepeatAssemblyController {
  constructor(private readonly repeats: FbsRepeatAssemblyService) {}

  @Get('capabilities')
  capabilities(@CurrentUser() user: AuthUser) { return this.repeats.capabilities(user); }

  @Post('preview')
  preview(@Body() dto: PreviewFbsRepeatAssemblyDto, @CurrentUser() user: AuthUser) {
    return this.repeats.preview(dto, user);
  }

  @Post()
  create(@Body() dto: CreateFbsRepeatAssemblyDto, @CurrentUser() user: AuthUser) {
    return this.repeats.create(dto, user);
  }
}
