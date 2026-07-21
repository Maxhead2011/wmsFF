import { Type } from 'class-transformer';
import { FbsDeliveryDestination } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

export class FbsOrderSelectionItemDto {
  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 100)
  id!: string;
}

export class FbsOrderSelectionDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => FbsOrderSelectionItemDto)
  orders!: FbsOrderSelectionItemDto[];

  @IsOptional()
  @IsEnum(FbsDeliveryDestination)
  deliveryDestination?: FbsDeliveryDestination;
}
