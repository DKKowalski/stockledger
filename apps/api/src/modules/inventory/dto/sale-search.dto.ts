import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SaleSearchDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsDateString({ strict: true }) from?: string;
  @IsOptional() @IsDateString({ strict: true }) to?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
