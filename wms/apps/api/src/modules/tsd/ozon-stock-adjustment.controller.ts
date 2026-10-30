import {Body,Controller,Get,Param,Post} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {RequirePermissions} from '../auth/decorators/require-permissions.decorator';
import type {AuthUser} from '../auth/auth.types';
import {OzonStockAdjustmentService} from './ozon-stock-adjustment.service';
// FIX: customers adjust their own requests; the service retains staff stock-write requirements.
@Controller('tsd/requests/:id/fbo/ozon-adjustment')
@RequirePermissions('client-requests:write')
export class OzonStockAdjustmentController {
 constructor(private readonly service:OzonStockAdjustmentService){}
 @Post('sync-preview') syncPreview(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.syncPreview(id,user);}
 @Post('sync-apply') syncApply(@Param('id') id:string,@Body() body:{token:string;confirm:boolean},@CurrentUser() user:AuthUser){return this.service.syncApply(id,body,user);}
 @Get() view(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.view(id,user);}
 @Post('preview') preview(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.preview(id,user);}
 @Post('start') start(@Param('id') id:string,@Body() body:{token:string;quantities:number[];confirm:boolean},@CurrentUser() user:AuthUser){return this.service.start(id,body,user);}
 @Post('resume') resume(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.resume(id,user);}
 @Post('cancel') cancel(@Param('id') id:string,@CurrentUser() user:AuthUser){return this.service.cancel(id,user);}
}
