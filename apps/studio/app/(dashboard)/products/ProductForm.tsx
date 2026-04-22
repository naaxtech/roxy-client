'use client';

import { useTransition, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { createProduct, updateProduct } from './actions';

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

export function ProductForm({ product, onClose }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const formRef = useRef<HTMLFormElement>(null);

  const isEdit = Boolean(product);

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

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-md space-y-4 p-6">
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
                <option key={value} value={value}>
                  {label}
                </option>
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
      </div>
    </div>,
    document.body
  );
}
