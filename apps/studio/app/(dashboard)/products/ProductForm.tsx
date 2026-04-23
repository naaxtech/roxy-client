'use client';

import { useTransition, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import { createProduct, updateProduct, saveProductPhoto, deleteProductPhoto, setCoverPhoto } from './actions';

type ProductPhoto = {
  id: string;
  url: string;
  position: number;
};

type Product = {
  id: string;
  name: string;
  category: string;
  base_price_cents: number;
  description?: string | null;
  is_active: boolean;
};

type Props = {
  product?: Product;
  onClose: () => void;
};

const CATEGORIES = [
  { value: 'apparel',     label: 'Apparel' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'beauty',      label: 'Beauty' },
  { value: 'art',         label: 'Art' },
  { value: 'food',        label: 'Food' },
  { value: 'books',       label: 'Books' },
  { value: 'other',       label: 'Other' },
];

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTOS = 4;

export function ProductForm({ product, onClose }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const formRef = useRef<HTMLFormElement>(null);

  // Photo state — only active in edit mode
  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingCoverId, setSettingCoverId] = useState<string | null>(null);

  const isEdit = Boolean(product);
  const supabase = createClient();

  // Fetch existing photos when editing
  const fetchPhotos = useCallback(async () => {
    if (!product?.id) return;
    setPhotoLoading(true);
    const { data } = await supabase
      .from('product_photos')
      .select('id, url, position')
      .eq('product_id', product.id)
      .order('position', { ascending: true });
    setPhotos(data ?? []);
    setPhotoLoading(false);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  // --- Form submit ---
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (isActive) formData.set('is_active', 'on');
    else formData.delete('is_active');

    startTransition(async () => {
      try {
        if (isEdit && product) {
          await updateProduct(product.id, formData);
        } else {
          await createProduct(formData);
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    });
  };

  // --- Photo upload ---
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !product?.id) return;

    setPhotoError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhotoError('Only JPEG, PNG and WebP files are accepted.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setPhotoError('File must be under 5 MB.');
      return;
    }
    if (photos.length >= MAX_PHOTOS) {
      setPhotoError('Maximum 4 photos per product.');
      return;
    }

    const ext = file.name.split('.').pop() ?? 'jpg';
    const uuid = crypto.randomUUID();

    // Get business_id for storage path
    const { data: productRow } = await supabase
      .from('products')
      .select('business_id')
      .eq('id', product.id)
      .single();
    if (!productRow) { setPhotoError('Could not determine business.'); return; }

    const storagePath = `${productRow.business_id}/${product.id}/${uuid}.${ext}`;
    setUploadingIdx(photos.length);

    const { error: uploadError } = await supabase.storage
      .from('product-photos')
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    setUploadingIdx(null);

    if (uploadError) {
      setPhotoError(uploadError.message);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('product-photos')
      .getPublicUrl(storagePath);

    try {
      await saveProductPhoto(product.id, publicUrl, photos.length);
      await fetchPhotos();
    } catch (err) {
      // Rollback storage upload on DB failure
      await supabase.storage.from('product-photos').remove([storagePath]);
      setPhotoError(err instanceof Error ? err.message : 'Failed to save photo.');
    }
  };

  // --- Delete photo ---
  const handleDelete = async (photo: ProductPhoto) => {
    if (!product?.id || !window.confirm('Remove this photo?')) return;
    setDeletingId(photo.id);
    setPhotoError(null);
    try {
      const storageBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/`;
      const storagePath = photo.url.replace(storageBase, '');
      await deleteProductPhoto(photo.id, product.id, storagePath);
      await fetchPhotos();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to delete photo.');
    } finally {
      setDeletingId(null);
    }
  };

  // --- Set cover ---
  const handleSetCover = async (photo: ProductPhoto) => {
    if (!product?.id || photo.position === 0) return;
    setSettingCoverId(photo.id);
    setPhotoError(null);
    try {
      await setCoverPhoto(photo.id, product.id);
      await fetchPhotos();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to set cover.');
    } finally {
      setSettingCoverId(null);
    }
  };

  const photosBusy = uploadingIdx !== null || deletingId !== null || settingCoverId !== null;

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Product' : 'Add Product'}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              maxLength={200}
              defaultValue={product?.name ?? ''}
              placeholder="Product name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              maxLength={2000}
              defaultValue={product?.description ?? ''}
              placeholder="Describe your product…"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select id="category" name="category" defaultValue={product?.category ?? 'other'} required>
              {CATEGORIES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="base_price_cents">Price (USD)</Label>
            <Input
              id="base_price_cents"
              name="base_price_cents"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={product ? (product.base_price_cents / 100).toFixed(2) : ''}
              placeholder="0.00"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_active"
              name="is_active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            <Label htmlFor="is_active" className="cursor-pointer">
              Active (visible to buyers)
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </form>

        {/* ── Photos section (edit mode only) ── */}
        {isEdit && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                Photos{' '}
                <span className="text-muted-foreground font-normal">
                  ({photos.length}/{MAX_PHOTOS})
                </span>
              </Label>
            </div>

            {photoLoading ? (
              <p className="text-xs text-muted-foreground">Loading photos…</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className="relative w-20 h-20 rounded overflow-hidden border group"
                  >
                    <button
                      type="button"
                      onClick={() => handleSetCover(photo)}
                      disabled={photosBusy || photo.position === 0}
                      className="w-full h-full"
                      title={photo.position === 0 ? 'Cover photo' : 'Click to make cover'}
                    >
                      <Image
                        src={photo.url}
                        alt="Product photo"
                        fill
                        className="object-cover"
                        sizes="80px"
                      />
                      {settingCoverId === photo.id && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <span className="text-white text-xs">…</span>
                        </div>
                      )}
                    </button>

                    {/* Cover label */}
                    {photo.position === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-primary/80 text-primary-foreground text-[10px] text-center font-semibold py-0.5 pointer-events-none">
                        COVER
                      </span>
                    )}

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => handleDelete(photo)}
                      disabled={photosBusy}
                      aria-label="Remove photo"
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 hover:bg-destructive text-white rounded-full text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>

                    {/* Deleting overlay */}
                    {deletingId === photo.id && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-xs">…</span>
                      </div>
                    )}
                  </div>
                ))}

                {/* Upload slot — shown when < 4 photos */}
                {photos.length < MAX_PHOTOS && (
                  <label
                    className={`w-20 h-20 rounded border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors ${
                      photosBusy ? 'opacity-50 pointer-events-none' : ''
                    }`}
                  >
                    {uploadingIdx !== null ? (
                      <span className="text-xs text-muted-foreground">…</span>
                    ) : (
                      <>
                        <span className="text-xl text-muted-foreground leading-none">+</span>
                        <span className="text-[10px] text-muted-foreground text-center leading-tight">
                          Add Photo
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={handleFileSelect}
                      disabled={photosBusy}
                    />
                  </label>
                )}
              </div>
            )}

            {photoError && (
              <p className="text-xs text-destructive">{photoError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              First photo is the cover. Click any photo to make it the cover.
            </p>
          </div>
        )}

        {/* Hint for new products */}
        {!isEdit && (
          <p className="text-xs text-muted-foreground border-t pt-3">
            Save the product first, then edit it to add photos.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
