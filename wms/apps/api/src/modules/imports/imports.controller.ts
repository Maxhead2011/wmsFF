import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ImportsService } from './imports.service';

@ApiTags('imports')
@RequirePermissions('imports:write')
@Controller('imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('stocks/preview')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл остатков и clientId' })
  @UseInterceptors(FileInterceptor('file'))
  previewStockFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.importsService.previewStockWorkbook(file.buffer, clientId, user);
  }

  @Post('stocks/commit')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл остатков, clientId и sourceDocument' })
  @UseInterceptors(FileInterceptor('file'))
  commitStockFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
    @Body('sourceDocument') sourceDocument?: string,
  ) {
    return this.importsService.commitStockWorkbook(file.buffer, {
      clientId,
      sourceDocument: sourceDocument || file.originalname,
      user,
    });
  }

  @Post('receipts/preview')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл приемки с коробами, баркодами и КИЗ' })
  @UseInterceptors(FileInterceptor('file'))
  previewReceiptFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.importsService.previewReceiptWorkbook(file.buffer, clientId, user);
  }

  @Post('receipts/commit')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл приемки, clientId и sourceDocument' })
  @UseInterceptors(FileInterceptor('file'))
  commitReceiptFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('clientId') clientId: string,
    @CurrentUser() user: AuthUser,
    @Body('sourceDocument') sourceDocument?: string,
  ) {
    return this.importsService.commitReceiptWorkbook(file.buffer, {
      clientId,
      sourceDocument: sourceDocument || file.originalname,
      user,
    });
  }

  @Post('logistics/preview')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл тарифов логистики' })
  @UseInterceptors(FileInterceptor('file'))
  previewLogisticsFile(@UploadedFile() file: Express.Multer.File) {
    return this.importsService.previewLogisticsWorkbook(file.buffer);
  }

  @Post('logistics/commit')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'XLSX-файл тарифов логистики, имя набора и период активности' })
  @UseInterceptors(FileInterceptor('file'))
  commitLogisticsFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('name') name?: string,
    @Body('activeFrom') activeFrom?: string,
    @Body('activeTo') activeTo?: string,
  ) {
    return this.importsService.commitLogisticsWorkbook(file.buffer, {
      name: name || file.originalname,
      sourceFile: file.originalname,
      activeFrom,
      activeTo,
    });
  }
}
