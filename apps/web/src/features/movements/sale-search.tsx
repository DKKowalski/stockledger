import { InputControl } from '../../components/ui/input-control';
import { SelectControl } from '../../components/inventory-ui';
import { useInventoryStore } from '../../app/inventory-store';

export type SaleSearch = { search?: string; from?: string; to?: string; itemId?: string; locationId?: string; offset?: string; limit?: string };
export function SaleSearchFields({ value, onChange, count }: { value: SaleSearch; onChange: (next: SaleSearch) => void; count: number }) {
  const { snapshot } = useInventoryStore();
  const change = (key: keyof SaleSearch, next: string) => onChange({ ...value, [key]: next, offset: '0' });
  return <div className="form-grid">
    <label><span>Find sale by reference, full ID or item name</span><InputControl value={value.search ?? ''} onValueChange={v => change('search', v)} /></label>
    <label><span>Sales from</span><InputControl type="date" value={value.from ?? ''} onValueChange={v => change('from', v)} /></label>
    <label><span>Sales to</span><InputControl type="date" value={value.to ?? ''} onValueChange={v => change('to', v)} /></label>
    <label><span>Sale item</span><SelectControl aria-label="Sale item" value={value.itemId ?? ''} onValueChange={v => change('itemId', v)} options={[{value:'',label:'All items'},...(snapshot?.items ?? []).map(i => ({value:i.id,label:i.name}))]} /></label>
    <label><span>Sale shop</span><SelectControl aria-label="Sale shop" value={value.locationId ?? ''} onValueChange={v => change('locationId', v)} options={[{value:'',label:'All places'},...(snapshot?.locations ?? []).map(i => ({value:i.id,label:i.name}))]} /></label>
    <div className="form-actions"><button type="button" className="button secondary" disabled={!Number(value.offset)} onClick={() => onChange({...value,offset:String(Math.max(0,Number(value.offset)-50))})}>Newer sales</button><button type="button" className="button secondary" disabled={count<50} onClick={() => onChange({...value,offset:String(Number(value.offset ?? 0)+50)})}>Older sales</button></div>
    <p role="status">{count} matching sales on this page. Search any sale date; there is no return-age limit.</p>
  </div>;
}
