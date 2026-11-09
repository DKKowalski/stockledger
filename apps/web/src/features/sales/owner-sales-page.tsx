import { useState } from 'react';
import { AuthContext, useAuth } from '../../auth-context';
import { useInventoryStore } from '../../app/inventory-store';
import { SelectControl } from '../../components/inventory-ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { hasPendingSale } from './checkout';
import { ShopSalesPage } from './shop-sales-page';

// Reuse the same checkout and durable recovery keys with an explicit shop scope.
// The actor remains the owner; the server independently validates the chosen shop.
export function OwnerSalesPage() {
  const auth = useAuth();
  const { snapshot } = useInventoryStore();
  const key = `stockledger:owner-sale-shop:${auth.user!.companyId}:${auth.user!.id}`;
  const [locationId, setLocationId] = useState(() => {
    try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
  });
  const [blocked, setBlocked] = useState(false);
  const shops = snapshot?.locations.filter(place => place.type === 'shop') ?? [];
  const selected = shops.some(shop => shop.id === locationId) ? locationId : '';
  const user = { ...auth.user!, locationId: selected };
  let pending = hasPendingSale(user);
  try { pending ||= localStorage.getItem(`stockledger:retail-sale:${user.companyId}:${user.id}:${selected}`) !== null; } catch { pending = true; }
  return <>
    <Card className="mb-4">
      <CardHeader><CardTitle><h2 className="text-base font-semibold">Sale location</h2></CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <Label className="grid gap-2 sm:max-w-sm"><span>Shop for this sale</span><SelectControl aria-label="Shop for this sale" value={selected} disabled={pending} onValueChange={value => {
          // Recheck storage at the action: a request may have started since this render.
          if (hasPendingSale(user) || localStorage.getItem(`stockledger:retail-sale:${user.companyId}:${user.id}:${selected}`)) { setBlocked(true); return; }
          localStorage.setItem(key, value); setLocationId(value); setBlocked(false);
        }} options={[{ value: '', label: 'Choose a shop' }, ...shops.map(shop => ({ value: shop.id, label: shop.name }))]} /></Label>
        {(pending || blocked) && <p className="text-sm" role="status">Confirm the pending sale before changing shops.</p>}
      </CardContent>
    </Card>
    {selected && <AuthContext.Provider value={{ ...auth, user }}><ShopSalesPage key={selected} /></AuthContext.Provider>}
  </>;
}
