import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KizLocationService } from './kiz-location.service';

export class CheckKizLocationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  kiz!: string;
}
export class DecideKizReviewDto {
  @IsIn(['REUSE','RELABEL']) resolution!: 'REUSE'|'RELABEL';
  @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
  @IsBoolean() confirmed!: boolean;
}

// FIX: authenticate globally and authorize in the service; scanning does not modify stock.
@Controller('inventory/kiz-location')
export class KizLocationController {
  constructor(private readonly location: KizLocationService) {}
  @Get('reviews')
  reviews(@CurrentUser() user: AuthUser, @Query('cursor') cursor?: string) {
    return this.location.reviews(user, cursor);
  }
  @Post('reviews/:id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideKizReviewDto, @CurrentUser() user: AuthUser) {
    return this.location.decideReview(id,dto.resolution,dto.reason,dto.confirmed,user);
  }
  @Post('check')
  check(@Body() dto: CheckKizLocationDto, @CurrentUser() user: AuthUser) {
    return this.location.lookup(dto.kiz, user);
  }
}
