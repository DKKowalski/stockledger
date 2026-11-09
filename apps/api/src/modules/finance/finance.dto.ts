import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class FinanceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
export class FinanceCategoryDto {
  @IsString()
  @MaxLength(80)
  name!: string;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
export class FinanceEntryDto {
  @IsIn(['expense', 'other_revenue'])
  kind!: 'expense' | 'other_revenue';
  @IsOptional()
  @IsUUID()
  categoryId?: string;
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  entryDate!: string;
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amountCents!: number;
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
export class BudgetLineDto {
  @IsString()
  @MaxLength(80)
  lineKey!: string;
  @IsInt()
  @Min(0)
  @Max(2147483647)
  amountCents!: number;
}
export class SaveBudgetDto {
  @Matches(/^\d{4}-\d{2}-01$/)
  month!: string;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
  @IsOptional()
  @IsBoolean()
  copyToYear?: boolean;
}
export class SplitPartDto {
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,40}$/)
  key?: string;
  @IsString()
  @MaxLength(80)
  name!: string;
  @IsString()
  @MaxLength(120)
  destination!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  percent!: number;
}
export class SaveProfitSplitDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitPartDto)
  parts!: SplitPartDto[];
}
export class CompleteSplitPartDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  doneOn?: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
export class FinanceExportDto extends FinanceQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  month?: string;
  @IsOptional()
  @IsIn(['month', 'months', 'year'])
  view?: 'month' | 'months' | 'year';
}
