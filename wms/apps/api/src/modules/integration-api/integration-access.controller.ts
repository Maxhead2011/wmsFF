import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CreateIntegrationCredentialDto } from './dto/create-integration-credential.dto';
import { IntegrationAccessService } from './integration-access.service';

@ApiTags('integration-access')
@ApiBearerAuth()
@RequirePermissions('integration-api:manage')
@Controller('integration-access')
export class IntegrationAccessController {
  constructor(private readonly service: IntegrationAccessService) {}

  @Get('scopes')
  @ApiOperation({ summary: 'Доступные права внешнего API' })
  scopes() {
    return this.service.scopes();
  }

  @Get('options')
  @ApiOperation({ summary: 'Доступные клиенту склады для выпуска ключа' })
  options(@CurrentUser() user: AuthUser) {
    return this.service.options(user);
  }

  @Get('credentials')
  @ApiOperation({ summary: 'Список ключей без секретной части' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post('credentials')
  @ApiOperation({ summary: 'Создать API-ключ; секрет возвращается один раз' })
  create(@Body() dto: CreateIntegrationCredentialDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post('credentials/:id/rotate')
  @ApiOperation({ summary: 'Заменить ключ и немедленно отключить старый' })
  rotate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.rotate(id, user);
  }

  @Post('credentials/:id/revoke')
  @ApiOperation({ summary: 'Отозвать API-ключ' })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user);
  }
}
