import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length, ValidateNested } from 'class-validator';

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
}
