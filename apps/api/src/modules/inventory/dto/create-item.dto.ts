import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  sku?: string;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sellingPriceCents?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  openingStock!: number;

  @IsUUID()
  locationId!: string;
}
