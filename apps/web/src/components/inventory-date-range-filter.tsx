import { useInventoryStore } from '../app/inventory-store';
import { DateRangePicker } from './ui/date-range-picker';

export function InventoryDateRangeFilter() {
  const { dateRange, setDateRange } = useInventoryStore();
  return <DateRangePicker value={dateRange} onChange={setDateRange} />;
}
