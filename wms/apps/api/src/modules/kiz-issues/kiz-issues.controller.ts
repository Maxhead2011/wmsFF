import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ResolveKizIssueDto } from './dto/resolve-kiz-issue.dto';
import { WriteOffKizDiscrepancyDto } from './dto/write-off-kiz-discrepancy.dto';
import { KizIssuesService } from './kiz-issues.service';

@Controller('kiz')
@RequirePermissions('system:admin')
export class KizIssuesController {
  constructor(private readonly issues: KizIssuesService) {}

  @Get('issues')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.issues.list(
      {
        status,
        search,
        clientId,
        limit,
      },
      user,
    );
  }

  @Post('issues/:issueKey/resolve')
  resolve(
    @Param('issueKey') issueKey: string,
    @Body() dto: ResolveKizIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.resolve(issueKey, dto, user);
  }

  @Post('issues/:issueKey/read')
  markRead(
    @Param('issueKey') issueKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.markRead(issueKey, user);
  }

  @Get('discrepancies')
  listDiscrepancies(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.issues.listBoxDiscrepancies({ search, clientId, limit }, user);
  }

  @Post('discrepancies/write-off-all')
  writeOffAllDiscrepancies(
    @Body() dto: WriteOffKizDiscrepancyDto,
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.issues.writeOffAllBoxDiscrepancies(
      { search, clientId },
      dto,
      user,
    );
  }

  @Post('discrepancies/:boxId/:skuId/write-off')
  writeOffDiscrepancy(
    @Param('boxId') boxId: string,
    @Param('skuId') skuId: string,
    @Body() dto: WriteOffKizDiscrepancyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.writeOffBoxDiscrepancy(boxId, skuId, dto, user);
  }
}
