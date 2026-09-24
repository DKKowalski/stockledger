import { IsIn } from 'class-validator';

export const INVENTORY_SOURCES = ['spreadsheet', 'another_system', 'paper', 'starting_fresh'] as const;
export type InventorySource = typeof INVENTORY_SOURCES[number];

export class UpdateInventorySourceDto {
  @IsIn(INVENTORY_SOURCES)
  inventorySource!: InventorySource;
}
