import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class WmsAiChatDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  message!: string;
}

export class WmsAiLearnDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  question!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  solution!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({ require_protocol: true }, { each: true })
  sourceUrls?: string[];
}
