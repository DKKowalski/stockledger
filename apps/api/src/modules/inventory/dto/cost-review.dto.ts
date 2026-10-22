import { Equals, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class ConfirmCostDto {
  @IsInt() @Min(0) @Max(2147483647)
  expectedCostCents!: number;

  @IsString() @IsNotEmpty() @MaxLength(20)
  expectedUnit!: string;

  @IsString() @Matches(/^[A-Z]{3}$/)
  expectedCurrency!: string;

  @IsString() @IsNotEmpty() @MaxLength(80)
  expectedItemUpdatedAt!: string;

  @IsIn(['purchase_records', 'opening_records', 'free_acquisition'])
  source!: 'purchase_records' | 'opening_records' | 'free_acquisition';

  @IsString() @Matches(/\S/) @MaxLength(200)
  reference!: string;

  @Equals(true, { message: 'Confirm that you checked the current cost against your records' })
  confirmed!: boolean;
}
