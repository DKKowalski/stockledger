import { IsEmail, MaxLength } from 'class-validator';

export class RequestVerificationDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
