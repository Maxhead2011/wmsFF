import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientScopeService } from '../auth/client-scope.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { readLamodaLabel } from './lamoda-label.service';
import { buildLamodaLabelPdf, lamodaLabelImage } from './lamoda-label';

@Controller('print/lamoda')
@RequirePermissions('print:write')
export class LamodaLabelController {
 constructor(private readonly db:PrismaService,private readonly scopes:ClientScopeService){}
 // FIX: preview is read-only; printing stays in the existing explicit agent/browser workflow.
 @Get('label')
 async preview(@Query('skuId') skuId:string,@Query('barcode') barcode:string|undefined,@CurrentUser() user:AuthUser){
  if(!skuId)throw new BadRequestException('Выберите товар.');
  const sku=await this.db.sku.findFirst({where:{id:skuId,clientId:this.scopes.resolveClientFilter(user)},select:{id:true,clientId:true}});
  if(!sku)throw new BadRequestException('Товар недоступен.');
  this.scopes.requireClientAccess(user,sku.clientId,'read');
  const label=await readLamodaLabel(this.db,sku.clientId,sku.id,barcode);
  if(!label)throw new BadRequestException('Для клиента не настроен шаблон Lamoda с полными данными.');
  const pdf=await buildLamodaLabelPdf(label);
  return {clientId:sku.clientId,skuId:sku.id,barcode:label.barcode,article:label.article,widthMm:58,heightMm:40,imageBase64:await lamodaLabelImage(pdf),pdfBase64:pdf.toString('base64')};
 }
}
