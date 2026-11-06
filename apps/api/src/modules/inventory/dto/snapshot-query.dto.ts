import { DateRangeDto } from '../../../common/date-range.js';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID } from 'class-validator';

export class SnapshotQueryDto extends DateRangeDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 30;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
