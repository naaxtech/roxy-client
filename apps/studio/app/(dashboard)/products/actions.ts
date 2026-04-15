'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getOwnedBusiness } from '@/lib/business';

export async function createProduct(formData: FormData) {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const category = formData.get('category') as string;
  const priceInput = formData.get('base_price_cents') as string;
  const base_price_cents = Math.round(parseFloat(priceInput) * 100);
  const is_active = formData.get('is_active') === 'on';

  const { error } = await supabase.from('products').insert({
    business_id: business.id,
    name,
    description,
    category,
    base_price_cents,
    is_active,
    status: 'pending',
  });

  if (error) throw new Error(error.message);
  revalidatePath('/products');
}

export async function updateProduct(id: string, formData: FormData) {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const category = formData.get('category') as string;
  const priceInput = formData.get('base_price_cents') as string;
  const base_price_cents = Math.round(parseFloat(priceInput) * 100);
  const is_active = formData.get('is_active') === 'on';

  const { error } = await supabase
    .from('products')
    .update({ name, description, category, base_price_cents, is_active })
    .eq('id', id)
    .eq('business_id', business.id);

  if (error) throw new Error(error.message);
  revalidatePath('/products');
}

export async function archiveProduct(id: string) {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const { error } = await supabase
    .from('products')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('business_id', business.id);

  if (error) throw new Error(error.message);
  revalidatePath('/products');
}

export async function toggleProductActive(id: string, isActive: boolean) {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const { error } = await supabase
    .from('products')
    .update({ is_active: isActive })
    .eq('id', id)
    .eq('business_id', business.id);

  if (error) throw new Error(error.message);
  revalidatePath('/products');
}
