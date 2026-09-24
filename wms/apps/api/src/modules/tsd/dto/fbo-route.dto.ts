import { IsOptional, IsString, MaxLength } from 'class-validator';
// FIX: bounded per-terminal routing hints; no database state or reservations.
export class FboRouteDto {
  @IsOptional() @IsString() @MaxLength(200) sourceBoxCode?: string;
  @IsOptional() @IsString() @MaxLength(200) palletCode?: string;
}
