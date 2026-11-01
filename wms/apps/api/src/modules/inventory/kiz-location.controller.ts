import { DecideKizReviewDto } from './kiz-review-decision.dto';
export { DecideKizReviewDto } from './kiz-review-decision.dto';
import { Body, Controller, Post, Get, Query, Param } from '@nestjs/common';
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
  // FIX: keep the published review routes represented in source.
  @Get('reviews')
  reviews(@CurrentUser() user: AuthUser, @Query('cursor') cursor?: string, @Query('status') status?:string) { return this.location.reviews(user, cursor, status); }
  @Post('reviews/:id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideKizReviewDto, @CurrentUser() user: AuthUser) {
    return this.location.decideReview(id, dto.resolution, dto.reason, dto.confirmed, user);
  }
  @Post('check')
  check(@Body() dto: CheckKizLocationDto, @CurrentUser() user: AuthUser) {
    return this.location.lookup(dto.kiz, user);
  }
}
