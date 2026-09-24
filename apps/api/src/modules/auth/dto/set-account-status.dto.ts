import { IsBoolean } from 'class-validator';

export class SetAccountStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
