import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { ProductsClient } from './ProductsClient';

export default async function ProductsPage() {
  const business = await getOwnedBusiness();
  if (!business) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-muted-foreground">
          You need a business to manage products.{' '}
          <a href="/settings" className="text-primary underline-offset-4 hover:underline">
            Create one in Settings.
          </a>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products')
    .select(
      'id, name, category, base_price_cents, status, is_active, description, created_at, product_variants(count), product_photos(count)'
    )
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-muted-foreground mt-1">
          Manage your product catalogue for{' '}
          <span className="font-medium text-foreground">{business.name}</span>.
        </p>
      </div>

      <ProductsClient products={products ?? []} />
    </div>
  );
}
