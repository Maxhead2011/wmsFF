import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class IncomingPaymentAllocationDto {
  @IsString()
  invoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amountRub!: number;
}

export class CreateIncomingPaymentDto {
  @IsString()
  clientId!: string;

  @IsNumber()
  @Min(0.01)
  totalRub!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IncomingPaymentAllocationDto)
  allocations!: IncomingPaymentAllocationDto[];

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
