import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { SetTsdActivationCodeDto } from './dto/set-tsd-activation-code.dto';
import { UpdateUserClientScopesDto } from './dto/update-user-client-scopes.dto';
import { UpdateUserPrinterScopesDto } from './dto/update-user-printer-scopes.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Post()
  @RequirePermissions('users:write')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.users.create(dto, user);
  }

  @Patch(':id/client-scopes')
  @RequirePermissions('users:write')
  updateClientScopes(@Param('id') id: string, @Body() dto: UpdateUserClientScopesDto, @CurrentUser() user: AuthUser) {
    return this.users.updateClientScopes(id, dto, user);
  }

  @Patch(':id/printer-scopes')
  @RequirePermissions('users:write')
  updatePrinterScopes(@Param('id') id: string, @Body() dto: UpdateUserPrinterScopesDto, @CurrentUser() user: AuthUser) {
    return this.users.updatePrinterScopes(id, dto, user);
  }

  @Patch(':id/profile')
  @RequirePermissions('users:write')
  updateProfile(@Param('id') id: string, @Body() dto: UpdateUserProfileDto, @CurrentUser() user: AuthUser) {
    return this.users.updateProfile(id, dto, user);
  }

  @Patch(':id/roles')
  @RequirePermissions('users:write')
  updateRoles(@Param('id') id: string, @Body() dto: UpdateUserRolesDto, @CurrentUser() user: AuthUser) {
    return this.users.updateRoles(id, dto, user);
  }

  @Patch(':id/tsd-activation-code')
  @RequirePermissions('system:admin')
  setTsdActivationCode(@Param('id') id: string, @Body() dto: SetTsdActivationCodeDto) {
    return this.users.setTsdActivationCode(id, dto);
  }

  @Delete(':id/tsd-activation-code')
  @RequirePermissions('system:admin')
  clearTsdActivationCode(@Param('id') id: string) {
    return this.users.clearTsdActivationCode(id);
  }

  @Get('roles')
  @RequirePermissions('users:read')
  listRoles(@CurrentUser() user: AuthUser) {
    return this.users.listRoles(user);
  }
}
