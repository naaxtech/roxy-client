import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { OrdersClient } from './OrdersClient';

export default async function OrdersPage() {
  const business = await getOwnedBusiness();

  if (!business) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-muted-foreground">
          You need a business to view orders.{' '}
          <a href="/settings" className="text-primary underline-offset-4 hover:underline">
            Create one in Settings.
          </a>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  let orders: any[] = [];
  try {
    const { data: ordersData, error: fnError } = await supabase.functions.invoke('get-orders-business', {
      body: { business_id: business.id },
    });
    if (fnError) throw fnError;
    orders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders ?? []);
  } catch {
    return (
      <div className="max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-destructive text-sm">
          Failed to load orders. Please refresh the page or contact support if this continues.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-muted-foreground mt-1">
          Manage orders for{' '}
          <span className="font-medium text-foreground">{business.name}</span>.
        </p>
      </div>

      <OrdersClient orders={orders} />
    </div>
  );
}
