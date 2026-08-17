import { IsEmail, IsString, Length } from 'class-validator';

export class BootstrapAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Length(10, 200)
  password!: string;

  @IsString()
  @Length(16, 200)
  bootstrapSecret!: string;
}
