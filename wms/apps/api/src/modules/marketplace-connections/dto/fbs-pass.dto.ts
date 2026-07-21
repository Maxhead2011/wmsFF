import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class FbsPassDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 60)
  firstName!: string;

  @IsString()
  @Length(1, 60)
  lastName!: string;

  @IsString()
  @Length(1, 100)
  carModel!: string;

  @IsString()
  @Length(6, 9)
  carNumber!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  officeId!: number;
}
