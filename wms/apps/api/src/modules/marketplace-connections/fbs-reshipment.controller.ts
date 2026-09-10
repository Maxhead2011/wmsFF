import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions } from '../auth/decorators/require-permissions.decorator';
import { CheckFbsReshipmentDto, CreateFbsReshipmentDto, PreviewFbsReshipmentDto, ResumeFbsReshipmentDto } from './dto/fbs-reshipment.dto';
import { FbsReshipmentService } from './fbs-reshipment.service';

// FIX: isolated endpoints; capabilities are false until explicitly enabled.
@Controller(['marketplace-connections/fbs/reshipment', 'marketplace-connection/fbs/reshipment'])
@RequireAnyPermissions('clients:write', 'client-requests:write')
export class FbsReshipmentController {
  constructor(private readonly reshipments: FbsReshipmentService) {}
  @Get('capabilities') capabilities(@CurrentUser() user: AuthUser) { return this.reshipments.capabilities(user); }
  @Post('check') check(@Body() dto: CheckFbsReshipmentDto, @CurrentUser() user: AuthUser) { return this.reshipments.check(dto, user); }
  @Post('preview') preview(@Body() dto: PreviewFbsReshipmentDto, @CurrentUser() user: AuthUser) { return this.reshipments.preview(dto, user); }
  @Post('create') create(@Body() dto: CreateFbsReshipmentDto, @CurrentUser() user: AuthUser) { return this.reshipments.create(dto, user); }
  @Post('resume') resume(@Body() dto: ResumeFbsReshipmentDto, @CurrentUser() user: AuthUser) { return this.reshipments.resume(dto, user); }
}
