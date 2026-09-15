import { Body, Controller, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KizLocationService } from './kiz-location.service';

export class CheckKizLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  kiz!: string;
}

// FIX: authenticate globally and authorize in the service; scanning does not modify stock.
@Controller('inventory/kiz-location')
export class KizLocationController {
  constructor(private readonly location: KizLocationService) {}
  @Post('check')
  check(@Body() dto: CheckKizLocationDto, @CurrentUser() user: AuthUser) {
    return this.location.lookup(dto.kiz, user);
  }
}
