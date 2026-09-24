import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { FboProblemsService, ReportFilter } from './fbo-problems.service';
import type { RecoveryInput } from './fbo-problems-policy';
@Controller('administration/fbo-problems')
@RequirePermissions('system:admin')
export class FboProblemsController {
    constructor(private readonly service: FboProblemsService) { }
    @Get('capabilities')
    capabilities(
    @CurrentUser()
    user: AuthUser) { return this.service.capabilities(user); }
    @Get()
    list(
    @CurrentUser()
    user: AuthUser,
    @Query('search')
    search?: string) { return this.service.list(user, search); }
    @Get(':id')
    details(
    @Param('id')
    id: string,
    @CurrentUser()
    user: AuthUser) { return this.service.details(id, user); }
    @Post(':id/preview')
    preview(
    @Param('id')
    id: string,
    @Body()
    body: RecoveryInput,
    @CurrentUser()
    user: AuthUser) { return this.service.preview(id, body, user); }
    @Post(':id/apply')
    apply(
    @Param('id')
    id: string,
    @Body()
    body: {
        token: string;
    },
    @CurrentUser()
    user: AuthUser) { return this.service.apply(id, body.token, user); }
    @Get(':id/report')
    report(
    @Param('id')
    id: string,
    @Query()
    filter: ReportFilter,
    @CurrentUser()
    user: AuthUser) { return this.service.report(id, user, filter); }
    @Get(':id/report.xlsx')
    async excel(
    @Param('id')
    id: string,
    @Query()
    filter: ReportFilter,
    @CurrentUser()
    user: AuthUser,
    @Res({ passthrough: true })
    res: Response) { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="fbo-picking.xlsx"'); return new StreamableFile(await this.service.excel(id, user, filter)); }
    @Get(':id/files/:kind')
    async file(
    @Param('id')
    id: string,
    @Param('kind')
    kind: string,
    @CurrentUser()
    user: AuthUser,
    @Res({ passthrough: true })
    res: Response) { const file = await this.service.document(id, user, kind); res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`); return new StreamableFile(file.content); }
}
