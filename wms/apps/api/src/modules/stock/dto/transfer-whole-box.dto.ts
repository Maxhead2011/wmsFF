import { IsOptional, IsString, Length } from 'class-validator';

export class TransferWholeBoxDto {
  @IsString()
  clientId!: string;

  @IsString()
  fromBoxCode!: string;

  @IsString()
  toBoxCode!: string;

  @IsString()
  @Length(1, 200)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
