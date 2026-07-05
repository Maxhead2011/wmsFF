import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CreateTsdDeviceDto } from './dto/create-tsd-device.dto';
import { LoginTsdDeviceDto } from './dto/login-tsd-device.dto';
import { TsdDeviceService } from './tsd-device.service';

@ApiTags('tsd')
@Controller('tsd')
export class TsdDeviceController {
  constructor(private readonly devices: TsdDeviceService) {}

  @Get('clients')
  @ApiBearerAuth()
  @RequirePermissions('stock:write')
  listClients(@CurrentUser() user: AuthUser) {
    return this.devices.listClientsForDevice(user);
  }

  @Get('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:read')
  listDevices() {
    return this.devices.listDevices();
  }

  @Post('devices')
  @ApiBearerAuth()
  @RequirePermissions('users:write')
  createDevice(@Body() dto: CreateTsdDeviceDto) {
    return this.devices.createDevice(dto);
  }

  @Post('login')
  @Public()
  login(@Body() dto: LoginTsdDeviceDto) {
    return this.devices.login(dto);
  }
}
