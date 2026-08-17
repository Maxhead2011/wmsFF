import { Body, Controller, Get, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermissions, RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { WmsAiChatDto, WmsAiLearnDto } from './dto/wms-ai-chat.dto';
import { WmsAiService, type WmsAiTool } from './wms-ai.service';
import { WMS_AI_XLSX_MIME } from './wms-ai-xlsx';

@Controller('wms-ai')
@RequirePermissions('warehouse:read', 'stock:read')
export class WmsAiController {
  constructor(private readonly service: WmsAiService) {}

  @Post('chat')
  chat(@Body() dto: WmsAiChatDto, @CurrentUser() user: AuthUser) {
    return this.service.chat(dto.message, user);
  }

  @Post('knowledge')
  @RequireAnyPermissions('warehouse:write', 'stock:write')
  learn(@Body() dto: WmsAiLearnDto, @CurrentUser() user: AuthUser) {
    return this.service.learn(dto, user);
  }

  @Get('export.xlsx')
  async export(
    @Query('tool') tool: WmsAiTool,
    @Query() query: Record<string, string | undefined>,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.export(
      tool,
      {
        search: query.search,
        boxCode: query.boxCode,
        palletCode: query.palletCode,
        maxTotal: query.maxTotal ? Number(query.maxTotal) : undefined,
        minTotal: query.minTotal ? Number(query.minTotal) : undefined,
        clientSearch: query.clientSearch,
        requestNumber: query.requestNumber ? Number(query.requestNumber) : undefined,
        days: query.days ? Number(query.days) : undefined,
        status: query.status,
      },
      user,
    );
    response.setHeader('Content-Type', WMS_AI_XLSX_MIME);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="wms-ai.xlsx"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }
}
