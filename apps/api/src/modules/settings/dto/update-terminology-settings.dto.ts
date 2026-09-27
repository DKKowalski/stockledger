import { IsIn } from 'class-validator';

export const SHOP_TERMS = ['shop', 'branch', 'outlet', 'store'] as const;
export const WAREHOUSE_TERMS = ['warehouse', 'stockroom'] as const;
export const ITEM_TERMS = ['item', 'product', 'material'] as const;

export class UpdateTerminologySettingsDto {
  @IsIn(SHOP_TERMS)
  shopTerm!: typeof SHOP_TERMS[number];

  @IsIn(WAREHOUSE_TERMS)
  warehouseTerm!: typeof WAREHOUSE_TERMS[number];

  @IsIn(ITEM_TERMS)
  itemTerm!: typeof ITEM_TERMS[number];
}
