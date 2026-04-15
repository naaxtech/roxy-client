import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ProductApprovalClient } from './ProductApprovalClient';

export default async function StaffProductsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  const { data: pending } = await supabase
    .from('products')
    .select(
      'id, name, category, base_price_cents, description, created_at, businesses(name, owner_id)'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  const products = (pending ?? []).map(p => ({
    ...p,
    businesses: Array.isArray(p.businesses) ? p.businesses[0] ?? null : p.businesses,
  }));

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Product Approval</h1>
        {products.length > 0 && (
          <Badge variant="destructive">{products.length}</Badge>
        )}
      </div>
      <p className="text-muted-foreground -mt-4">
        Review and approve or reject seller product submissions.
      </p>

      <ProductApprovalClient products={products} />
    </div>
  );
}
