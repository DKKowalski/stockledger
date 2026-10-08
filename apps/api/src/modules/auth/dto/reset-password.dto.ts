import { IsString, MaxLength, MinLength } from 'class-validator';
import { TokenDto } from './token.dto.js';

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
