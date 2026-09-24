import { IsIn } from 'class-validator';

export const BUSINESS_TYPES = ['retail', 'wholesale', 'warehouse', 'mixed'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];

export class UpdateBusinessTypeDto {
  @IsIn(BUSINESS_TYPES)
  businessType!: BusinessType;
}
