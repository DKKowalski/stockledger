import { IsDateString, IsUUID } from 'class-validator';

export class StockCountPreviewDto {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  locationId!: string;

  @IsDateString({ strict: true })
  countedAt!: string;
}
