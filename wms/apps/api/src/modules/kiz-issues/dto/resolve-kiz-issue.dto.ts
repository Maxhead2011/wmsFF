import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveKizIssueDto {
  @IsIn([
    'REPLACE_KIZ',
    'REGISTER_EXTRA_UNIT',
    'PREPARE_EXTRA_UNIT',
    'RELEASE_BOX',
    'MARK_RESOLVED',
  ])
  action!:
    | 'REPLACE_KIZ'
    | 'REGISTER_EXTRA_UNIT'
    | 'PREPARE_EXTRA_UNIT'
    | 'RELEASE_BOX'
    | 'MARK_RESOLVED';

  @IsOptional()
  @IsString()
  @MaxLength(135)
  kiz?: string;

  @IsOptional()
  @IsBoolean()
  confirmBoxMove?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
