import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ListTurnoverDto, TurnoverStatisticsDto, TurnoverSuggestionsDto } from './dto/list-turnover.dto';
import { TurnoverActionDto } from './dto/turnover-action.dto';
import { TurnoverService } from './turnover.service';

@ApiTags('turnover')
@RequirePermissions('stock:read')
@Controller('turnover')
export class TurnoverController {
  constructor(private readonly turnover: TurnoverService) {}

  @Get('suggestions')
  suggestions(@Query() query: TurnoverSuggestionsDto, @CurrentUser() user: AuthUser) {
    return this.turnover.suggestions(query, user);
  }

  @Get()
  list(@Query() query: ListTurnoverDto, @CurrentUser() user: AuthUser) {
    return this.turnover.list(query, user);
  }

  @Get('statistics')
  statistics(@Query() query: TurnoverStatisticsDto, @CurrentUser() user: AuthUser) {
    return this.turnover.statistics(query, user);
  }

  @Post('actions')
  @RequirePermissions('stock:write')
  runAction(@Body() dto: TurnoverActionDto, @CurrentUser() user: AuthUser) {
    return this.turnover.runAction(dto, user);
  }
}
