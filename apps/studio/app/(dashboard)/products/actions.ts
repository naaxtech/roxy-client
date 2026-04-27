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

export async function saveProductPhoto(
  productId: string,
  url: string,
  position: number
): Promise<void> {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  // Verify product belongs to this business
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('business_id', business.id)
    .single();
  if (!product) throw new Error('Product not found');

  const { error } = await supabase
    .from('product_photos')
    .insert({ product_id: productId, url, position });
  if (error) throw new Error(error.message);
  revalidatePath('/products');
}

export async function deleteProductPhoto(
  photoId: string,
  productId: string,
  storagePath: string
): Promise<void> {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  // Delete from storage
  await supabase.storage.from('product-photos').remove([storagePath]);

  // Delete DB row
  const { error } = await supabase
    .from('product_photos')
    .delete()
    .eq('id', photoId);
  if (error) throw new Error(error.message);

  // Re-sequence remaining photos for this product
  const { data: remaining } = await supabase
    .from('product_photos')
    .select('id')
    .eq('product_id', productId)
    .order('position', { ascending: true });

  if (remaining) {
    for (let i = 0; i < remaining.length; i++) {
      await supabase
        .from('product_photos')
        .update({ position: i })
        .eq('id', remaining[i].id);
    }
  }

  revalidatePath('/products');
}

export async function setCoverPhoto(
  photoId: string,
  productId: string
): Promise<void> {
  const supabase = await createClient();
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  // Get all photos for this product in current order
  const { data: photos } = await supabase
    .from('product_photos')
    .select('id, position')
    .eq('product_id', productId)
    .order('position', { ascending: true });

  if (!photos) return;

  // Reorder: selected photo first, rest in original order
  const reordered = [
    photos.find(p => p.id === photoId)!,
    ...photos.filter(p => p.id !== photoId),
  ];

  for (let i = 0; i < reordered.length; i++) {
    await supabase
      .from('product_photos')
      .update({ position: i })
      .eq('id', reordered[i].id);
  }

  revalidatePath('/products');
}
