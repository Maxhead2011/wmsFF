import { Module,Controller,Get,Post,Param,Query } from '@nestjs/common';
import { OperationsToolsService } from './operations-tools.service';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
@Controller('operations-tools')
@RequirePermissions('client-requests:read')
export class OperationsToolsController {
  constructor(private readonly tools:OperationsToolsService){}
  @Get('capabilities') capabilities(){this.tools.enabled();return {enabled:true};}
  @Get('requests') requests(@Query('q')q:string,@CurrentUser()u:AuthUser){return this.tools.requests(q,u);}
  @Get('readiness/:id') readiness(@Param('id')id:string,@CurrentUser()u:AuthUser){return this.tools.readiness(id,u);}
  @Get('search') @RequirePermissions('client-requests:read','stock:read') search(@Query('q')q:string,@CurrentUser()u:AuthUser){return this.tools.search(q,u);}
  @Get('boxes/:id') @RequirePermissions('client-requests:read','stock:read') box(@Param('id')id:string,@CurrentUser()u:AuthUser){return this.tools.box(id,u);}
  @Get('attention') attention(@CurrentUser()u:AuthUser){return this.tools.attention(u);}
  @Post('attention/:key/take') @RequirePermissions('client-requests:read','client-requests:write') take(@Param('key')key:string,@CurrentUser()u:AuthUser){return this.tools.take(key,u);}
}
@Module({imports:[AuthModule],controllers:[OperationsToolsController],providers:[OperationsToolsService]})
export class OperationsToolsModule {}
