import { IsInt, Max, Min } from 'class-validator';

export class UpdateSellingPriceDto {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  sellingPriceCents!: number;
}
