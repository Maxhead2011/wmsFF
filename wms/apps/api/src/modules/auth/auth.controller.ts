import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('bootstrap')
  bootstrapAdmin(@Body() dto: BootstrapAdminDto) {
    return this.auth.bootstrapAdmin(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post('logout')
  @ApiBearerAuth()
  logout(@Req() request: Request) {
    return this.auth.logout(this.extractBearerToken(request.headers.authorization));
  }

  @Get('me')
  @ApiBearerAuth()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  private extractBearerToken(authorization?: string) {
    const [scheme, token] = authorization?.split(' ') ?? [];
    return scheme === 'Bearer' && token ? token : '';
  }
}
