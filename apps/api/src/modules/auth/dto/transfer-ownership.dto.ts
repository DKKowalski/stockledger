import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class TransferOwnershipDto {
  @IsUUID()
  targetUserId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;
}
