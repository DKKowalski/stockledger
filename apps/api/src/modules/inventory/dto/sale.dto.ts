import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class SaleQuoteLineDto {
  @IsUUID() itemId!: string;
  @IsInt() @Min(1) @Max(2147483647) quantity!: number;
  @IsOptional() @IsIn(['base', 'package']) quantityUnit?: 'base' | 'package';
  @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
  @IsInt() @Min(0) @Max(2147483647) expectedRetailPriceCents!: number;
}

export class SaleQuoteDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) movementDate!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => SaleQuoteLineDto)
  lines!: SaleQuoteLineDto[];
}

export class CompleteSaleDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) @MaxLength(100000)
  quoteToken!: string;
}
