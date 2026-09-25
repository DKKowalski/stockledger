import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteWorkspaceDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MaxLength(120)
  confirmation!: string;
}
