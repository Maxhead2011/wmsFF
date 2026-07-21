import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ClientRequestBoxSelectionDto {
  @IsString()
  requestItemId!: string;

  @IsString()
  boxId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdateClientRequestBoxSelectionDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ClientRequestBoxSelectionDto)
  selections!: ClientRequestBoxSelectionDto[];
}
