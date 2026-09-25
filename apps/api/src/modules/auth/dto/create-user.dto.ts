import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsIn(['inventory_manager', 'shop_attendant'])
  role!: 'inventory_manager' | 'shop_attendant';

  @IsOptional()
  @IsIn(['email', 'link'])
  delivery?: 'email' | 'link';

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
