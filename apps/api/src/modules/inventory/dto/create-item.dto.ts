import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  sku!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevel!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCostCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  openingStock!: number;

  @IsUUID()
  locationId!: string;
}
