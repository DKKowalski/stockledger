import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

class PackagePricingDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(20)
  label!: string;

  @IsInt() @Min(2) @Max(2147483647)
  size!: number;

  @IsInt() @Min(0) @Max(2147483647)
  priceCents!: number;
}

class BulkTierDto {
  @IsInt() @Min(1) @Max(2147483647)
  minimumQuantity!: number;

  @IsInt() @Min(0) @Max(2147483647)
  unitPriceCents!: number;
}

export class UpdatePricingDto {
  @IsInt() @Min(0) @Max(2147483646)
  expectedVersion!: number;

  @IsBoolean()
  previewEnabled!: boolean;

  @IsString() @IsNotEmpty() @MaxLength(20)
  baseUnit!: string;

  @Equals(true, { message: 'Confirm that existing quantities use this base unit' })
  baseUnitVerified!: boolean;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => PackagePricingDto)
  package?: PackagePricingDto | null;

  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => BulkTierDto)
  bulkTiers!: BulkTierDto[];
}

class QuoteLineDto {
  @IsUUID()
  itemId!: string;

  @IsInt() @Min(1) @Max(2147483647)
  quantity!: number;

  @IsOptional() @IsIn(['base', 'package'])
  quantityUnit?: 'base' | 'package';

  @IsOptional() @IsInt() @Min(0) @Max(2147483647)
  expectedVersion?: number;
}

export class PricingQuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
}
