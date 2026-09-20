import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateSizeSubstitutionDto, PreviewSizeSubstitutionDto } from './dto/fbs-size-substitution.dto';
import { FbsSizeSubstitutionService } from './fbs-size-substitution.service';

@Controller('marketplace-connections/fbs/size-substitution')
@RequirePermissions('clients:write')
export class FbsSizeSubstitutionController {
  constructor(private readonly service: FbsSizeSubstitutionService) {}
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) { return this.service.capabilities(user); }
  @Post('preview') preview(@Body() dto: PreviewSizeSubstitutionDto, @CurrentUser() user: AuthUser) { return this.service.preview(dto, user); }
  @Post() create(@Body() dto: CreateSizeSubstitutionDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user); }
}
