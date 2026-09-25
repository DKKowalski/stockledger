import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateStockCountDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  countedQuantity!: number;

  @IsDateString({ strict: true })
  countedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
