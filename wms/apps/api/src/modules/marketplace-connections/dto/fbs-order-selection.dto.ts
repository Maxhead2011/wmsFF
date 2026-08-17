import { Type } from 'class-transformer';
import { FbsDeliveryDestination } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class FbsOrderSelectionItemDto {
  @IsString()
  @Length(1, 100)
  connectionId!: string;

  @IsString()
  @Length(1, 100)
  id!: string;

  // Older/open browser sessions can submit the richer order preview object.
  // These display-only properties are deliberately ignored by the service,
  // but accepting their validated shape keeps actions compatible during rollout.
  @IsOptional()
  @IsString()
  @Length(1, 100)
  assemblyId?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresKiz?: boolean;

  @IsOptional()
  @IsBoolean()
  kizAccepted?: boolean;
}

export class FbsOrderSelectionDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  // A manager may select several large WMS requests at once. Marketplace
  // operations split the selection into WB-safe chunks inside the service,
  // so the transport DTO must not reject the combined selection at 1,000.
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => FbsOrderSelectionItemDto)
  orders!: FbsOrderSelectionItemDto[];

  @IsOptional()
  @IsEnum(FbsDeliveryDestination)
  deliveryDestination?: FbsDeliveryDestination;

  @IsOptional()
  @IsString()
  @Length(1, 260)
  marketplaceWarehouseKey?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  targetSupplyId?: string;
}
