import { IsString, Length, Matches } from 'class-validator';

export class RefreshContractDto {
  @IsString()
  @Length(64, 64)
  expectedFingerprint!: string;

  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'Пароль WMS не может быть пустым.' })
  wmsPassword!: string;
}
