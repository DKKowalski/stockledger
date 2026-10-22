import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../api';
import { useCompanySettings } from '../../app/company-settings-store';
import { useInventoryStore } from '../../app/inventory-store';
import { useAuth } from '../../auth-context';
import type { Item } from '../../types';

/** Whether this company has box and quantity deals switched on; null while loading. */
export function usePricingPreviewAvailable() {
  const { accessToken } = useAuth();
  const { settings } = useCompanySettings();
  const [available, setAvailable] = useState<boolean | null>(null);
  const switchedOn = settings?.hybridPricingEnabled;
  useEffect(() => {
    let active = true;
    if (accessToken) void api.pricingPreviewStatus(accessToken).then((status) => {
      if (active) setAvailable(status.available);
    }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [accessToken, switchedOn]);
  return available;
}

/** Archives or restores an item, reporting the server's reason when it refuses. */
export function useToggleItemActive() {
  const { accessToken } = useAuth();
  const { mutate } = useInventoryStore();
  return async (item: Item) => {
    if (!accessToken) return;
    try {
      await mutate(
        () => api.updateItem(accessToken, item.id, { isActive: !item.isActive }),
        item.isActive ? `${item.name} was archived.` : `${item.name} was restored.`,
      );
    } catch (caught) {
      toast.error(item.isActive ? 'Could not archive item' : 'Could not restore item', {
        description: caught instanceof Error ? caught.message : 'Try again.',
      });
    }
  };
}
