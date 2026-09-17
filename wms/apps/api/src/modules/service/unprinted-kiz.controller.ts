import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, IsUUID, Matches } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { UnprintedKizService } from './unprinted-kiz.service';
export class UnprintedKizQuery {
  @IsUUID() clientId!:string;
  @IsUUID() warehouseId!:string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!:string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!:string;
}
export class CreateKizSearchDto extends UnprintedKizQuery {
  @IsUUID() assignedToUserId!:string;
  @IsUUID() operationId!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all',{each:true}) scanIds!:string[];
}
// FIX: admin-only inspection and explicit creation, separate from printing and stock mutations.
@Controller('service/unprinted-kiz')
@RequirePermissions('system:admin')
export class UnprintedKizController {
  constructor(private readonly service:UnprintedKizService) {}
  @Get() report(@Query() input:UnprintedKizQuery,@CurrentUser() user:AuthUser) {return this.service.report(input,user);}
  @Get('assignees') assignees(@Query() input:UnprintedKizQuery,@CurrentUser() user:AuthUser) {return this.service.assignees(input,user);}
  @Post('requests') create(@Body() input:CreateKizSearchDto,@CurrentUser() user:AuthUser) {return this.service.create(input,user);}
}
