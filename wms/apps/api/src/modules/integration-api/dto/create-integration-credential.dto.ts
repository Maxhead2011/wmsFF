import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateIntegrationCredentialDto {
  @ApiProperty({ example: '1C Ногинск' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsUUID()
  clientId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ example: ['catalog:read', 'stock:read', 'stock:write'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  scopes!: string[];

  @ApiPropertyOptional({ example: ['159.194.217.147'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowedIps?: string[];

  @ApiPropertyOptional({ example: '2027-08-19T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
