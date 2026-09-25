import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { StockMovementType } from '../inventory.types.js';

export class CreateMovementDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @IsUUID()
  destinationLocationId?: string;

  @IsEnum(StockMovementType)
  type!: StockMovementType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsDateString({ strict: true })
  movementDate!: string;

  // Optional quote check only. The server always uses the catalog price.
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedUnitPriceCents?: number;

  @ValidateIf((body: CreateMovementDto) => body.type === StockMovementType.PURCHASE)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  unitCostCents?: number;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ValidateIf((body: CreateMovementDto) => body.type === StockMovementType.RETURN_IN)
  @IsUUID()
  relatedMovementId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
