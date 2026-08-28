import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { FbsOrderSelectionItemDto } from './fbs-order-selection.dto';

export const FBS_CANCELLED_REPORT_MAX_ORDERS = 50_000;

// ADDED: a read-only export DTO keeps bulk reporting limits away from write operations.
export class FbsCancelledOrdersReportDto {
  @IsString()
  @Length(1, 100)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  // FIX: cancelled history can exceed the 5,000-item limit used by write operations.
  @ArrayMaxSize(FBS_CANCELLED_REPORT_MAX_ORDERS)
  @ValidateNested({ each: true })
  @Type(() => FbsOrderSelectionItemDto)
  orders!: FbsOrderSelectionItemDto[];
}
