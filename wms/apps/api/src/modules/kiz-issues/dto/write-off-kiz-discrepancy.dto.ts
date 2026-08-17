import { Equals, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class WriteOffKizDiscrepancyDto {
  @IsBoolean()
  @Equals(true)
  confirm!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
