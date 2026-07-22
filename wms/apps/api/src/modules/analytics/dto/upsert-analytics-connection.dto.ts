import { IsString, Length } from 'class-validator';

export class UpsertAnalyticsConnectionDto {
  @IsString()
  @Length(80, 4000)
  apiKey!: string;
}
