import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min } from 'class-validator';

export class QuoteFbsCalculatorDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3000)
  quantity!: number;

  @IsString()
  destination!: string;
}
