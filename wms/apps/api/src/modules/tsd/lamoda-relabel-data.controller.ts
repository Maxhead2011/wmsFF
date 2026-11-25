import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {Type} from 'class-transformer';
import {ArrayMaxSize,IsArray,IsBoolean,IsNotEmpty,IsString,MaxLength,ValidateNested} from 'class-validator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {FboTwoStageService} from './fbo-two-stage.service';
class LamodaRelabelItemDto {
 @IsString() @IsNotEmpty() @MaxLength(200) skuId!:string;
 @IsString() @IsNotEmpty() @MaxLength(600) composition!:string;
 @IsString() @IsNotEmpty() @MaxLength(600) manufacturer!:string;
 @IsString() @IsNotEmpty() @MaxLength(600) origin!:string;
 @IsString() @IsNotEmpty() @MaxLength(10) manufacturedAt!:string;
}
export class LamodaRelabelDataDto {
 @IsBoolean() confirmed!:boolean;
 @IsArray() @ArrayMaxSize(1000) @ValidateNested({each:true}) @Type(()=>LamodaRelabelItemDto) labelData!:LamodaRelabelItemDto[];
}
@Controller('tsd/requests/:id/fbo/lamoda-relabel')
export class LamodaRelabelDataController {
 constructor(private readonly fbo:FboTwoStageService){}
 @Get('data') @RequirePermissions('stock:read')
 view(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.fbo.lamodaLabelData(id,user);}
 @Post('data') @RequirePermissions('stock:write')
 save(@Param('id') id:string,@Body() body:LamodaRelabelDataDto,@CurrentUser() user:AuthUser){return this.fbo.lamodaLabelData(id,user,body);}
}
