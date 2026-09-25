import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ProfitabilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 30;

  @IsOptional()
  @IsIn(['warehouse', 'shop'])
  locationType?: 'warehouse' | 'shop';

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}
