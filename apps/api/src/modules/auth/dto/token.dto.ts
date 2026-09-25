import { IsString, MaxLength, MinLength } from 'class-validator';

export class TokenDto {
  @IsString()
  @MinLength(38)
  @MaxLength(160)
  token!: string;
}

export class AcceptInvitationDto extends TokenDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
