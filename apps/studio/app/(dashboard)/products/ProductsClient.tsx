'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductForm } from './ProductForm';
import { archiveProduct, toggleProductActive } from './actions';
import { useRouter } from 'next/navigation';

type Product = {
  id: string;
  name: string;
  category: string;
  base_price_cents: number;
  status: string;
  is_active: boolean;
  description?: string | null;
  created_at: string;
  product_variants: { count: number }[];
  product_photos: { count: number }[];
};

type Tab = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pending',  className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-800 border-green-200' },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200' },
  archived: { label: 'Archived', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

export function ProductsClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const filtered = activeTab === 'all'
    ? products
    : products.filter(p => p.status === activeTab);

  const tabs: Tab[] = ['all', 'pending', 'approved', 'rejected'];

  const handleArchive = (id: string) => {
    startTransition(async () => {
      await archiveProduct(id);
      router.refresh();
    });
  };

  const handleToggleActive = (id: string, current: boolean) => {
    startTransition(async () => {
      await toggleProductActive(id, !current);
      router.refresh();
    });
  };

  const openAdd = () => {
    setEditProduct(undefined);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setShowForm(true);
  };

  const handleClose = () => {
    setShowForm(false);
    setEditProduct(undefined);
    router.refresh();
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={openAdd}>
          + Add Product
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products found.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">Category</th>
                <th className="text-right px-4 py-2.5 font-medium">Price</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-center px-4 py-2.5 font-medium">Variants</th>
                <th className="text-center px-4 py-2.5 font-medium">Photos</th>
                <th className="text-center px-4 py-2.5 font-medium">Active</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(p => {
                const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.pending;
                const variantCount = p.product_variants?.[0]?.count ?? 0;
                const photoCount = p.product_photos?.[0]?.count ?? 0;
                return (
                  <tr key={p.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium max-w-[180px] truncate">{p.name}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{p.category}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${(p.base_price_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={badge.className}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{variantCount}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{photoCount}</td>
                    <td className="px-4 py-3 text-center">
                      <Checkbox
                        checked={p.is_active}
                        disabled={isPending}
                        onCheckedChange={() => handleToggleActive(p.id, p.is_active)}
                        aria-label={`Toggle active for ${p.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(p)}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                        {p.status !== 'archived' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleArchive(p.id)}
                            disabled={isPending}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ProductForm product={editProduct} onClose={handleClose} />
      )}
    </>
  );
}
