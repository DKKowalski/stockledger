import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateInventorySettingsDto {
  @ValidateIf((_body, value) => value !== null)
  @IsUUID()
  defaultLocationId!: string | null;

  @IsString()
  @MaxLength(20)
  defaultUnit!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  defaultReorderLevel!: number;

  @IsString()
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, { message: 'SKU prefix can use letters, numbers and single dashes' })
  skuPrefix!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999999)
  nextSkuNumber!: number;

  @IsBoolean()
  allowNegativeStock!: boolean;

  @IsBoolean()
  requirePurchaseSource!: boolean;

  @IsBoolean()
  requireAdjustmentReason!: boolean;
}
