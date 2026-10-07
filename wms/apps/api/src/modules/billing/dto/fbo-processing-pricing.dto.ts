import { ArrayMaxSize, ArrayUnique, IsArray, IsDefined, IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
class FboProcessingComponentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    serviceId!: string;
    @IsString()
    @MaxLength(32)
    priceRub!: string;
    @IsString()
    @MaxLength(16)
    multiplier!: string;
    @IsIn(['INCLUDED', 'ADD_6_PERCENT'])
    taxMode!: 'INCLUDED' | 'ADD_6_PERCENT';
}
class FboProcessingVariantDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name!: string;
    @IsArray()
    @ArrayMaxSize(1000)
    @ArrayUnique()
    @IsString({ each: true })
    @MaxLength(100, { each: true })
    skuIds!: string[];
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => FboProcessingComponentDto)
    services!: FboProcessingComponentDto[];
}
class FboProcessingDefinitionDto {
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => FboProcessingComponentDto)
    common!: FboProcessingComponentDto[];
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => FboProcessingVariantDto)
    variants!: FboProcessingVariantDto[];
}
export class CreateFboProcessingTariffDto {
    @IsUUID()
    operationKey!: string;
    @IsDefined()
    @ValidateNested()
    @Type(() => FboProcessingDefinitionDto)
    definition!: FboProcessingDefinitionDto;
}
