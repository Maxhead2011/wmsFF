import {Controller,Get,Query} from '@nestjs/common';
import {Type} from 'class-transformer';
import {IsIn,IsInt,IsOptional,IsString,Max,MaxLength,Min} from 'class-validator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {FulfillmentAnalyticsService} from './fulfillment.service';
export class FulfillmentQueryDto{
 @IsString() @MaxLength(100) clientId!:string;
 @IsString() @MaxLength(100) warehouseId!:string;
 @IsString() @MaxLength(10) dateFrom!:string;
 @IsString() @MaxLength(10) dateTo!:string;
 @IsIn(['FBS','FBO']) channel!:'FBS'|'FBO';
 @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(90) leadDays?:number;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(90) reviewDays?:number;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(90) safetyDays?:number;
}
// FIX: authenticated client/warehouse scopes are enforced in the service for every query.
@Controller('analytics/fulfillment')
@RequirePermissions()
export class FulfillmentAnalyticsController{
 constructor(private readonly service:FulfillmentAnalyticsService){}
 @Get('clients') clients(@CurrentUser() user:AuthUser){return this.service.clients(user);}
 @Get('dashboard') dashboard(@Query() q:FulfillmentQueryDto,@CurrentUser() user:AuthUser){return this.service.dashboard(q,user);}
}
