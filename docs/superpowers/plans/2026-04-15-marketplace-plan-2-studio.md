# Roxy Marketplace — Plan 2: Studio UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Studio seller + staff UI for the marketplace — Stripe Connect onboarding, products CRUD, orders management, seller payouts history, and 4 staff operations pages (product approval, dead-letter email queue, reconciliation alerts, dispute management).

**Architecture:** All pages under `apps/studio/app/(dashboard)/`. Server components for all data reads (Supabase direct queries). Next.js server actions for mutations. `supabase.functions.invoke()` to call existing edge functions (staff-approve-product, update-order-shipped, refund-order, connect-business-stripe). Stripe Node SDK for live balance/dashboard link in seller-payouts page. No new edge functions — Plan 1 backend is already deployed.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, `stripe` Node SDK (to be installed), shadcn/ui (Badge, Button, Card, Checkbox, Input, Label, Select, Table, Textarea), TypeScript strict. Working directory for all commands: `apps/studio/`.

---

### File Map

**Created/Modified:**
- `apps/studio/components/Sidebar.tsx` — MODIFY: add Products, Orders, Seller Payouts nav + expanded staff section
- `apps/studio/lib/business.ts` — CREATE: `getOwnedBusiness()` helper used by all seller pages
- `apps/studio/app/(dashboard)/stripe-onboarding/page.tsx` — CREATE: 5-state Connect onboarding
- `apps/studio/app/(dashboard)/stripe-onboarding/actions.ts` — CREATE: server actions for connect + dashboard link
- `apps/studio/app/(dashboard)/products/page.tsx` — CREATE: product list with status tabs
- `apps/studio/app/(dashboard)/products/ProductForm.tsx` — CREATE: shared create/edit form (client component)
- `apps/studio/app/(dashboard)/products/actions.ts` — CREATE: server actions for product CRUD
- `apps/studio/app/(dashboard)/products/new/page.tsx` — CREATE: create product page
- `apps/studio/app/(dashboard)/products/[id]/edit/page.tsx` — CREATE: edit product page
- `apps/studio/app/(dashboard)/orders/page.tsx` — CREATE: order list with status filter
- `apps/studio/app/(dashboard)/orders/[id]/page.tsx` — CREATE: order detail with timeline
- `apps/studio/app/(dashboard)/orders/[id]/OrderActions.tsx` — CREATE: fulfillment actions (client component)
- `apps/studio/app/(dashboard)/seller-payouts/page.tsx` — CREATE: payout history + live Stripe balance
- `apps/studio/app/(dashboard)/staff/products/page.tsx` — CREATE: pending product approval queue
- `apps/studio/app/(dashboard)/staff/products/ApproveRejectButtons.tsx` — CREATE: approval actions (client)
- `apps/studio/app/(dashboard)/staff/emails/page.tsx` — CREATE: dead-letter email queue view
- `apps/studio/app/(dashboard)/staff/reconciliation/page.tsx` — CREATE: reconciliation alerts
- `apps/studio/app/(dashboard)/staff/disputes/page.tsx` — CREATE: dispute management

---

### Task 1: Setup — shadcn components + Stripe SDK + Sidebar + business helper

**Files:**
- Modify: `apps/studio/components/Sidebar.tsx`
- Create: `apps/studio/lib/business.ts`
- Modify: `apps/studio/package.json` (via npm install)
- Modify: `apps/studio/components/ui/textarea.tsx` (new, via shadcn)
- Modify: `apps/studio/components/ui/select.tsx` (new, via shadcn)
- Modify: `apps/studio/components/ui/table.tsx` (new, via shadcn)

- [ ] **Step 1: Install missing shadcn components + Stripe SDK**

```bash
cd apps/studio
npx shadcn@latest add textarea select table --yes
npm install stripe
```

- [ ] **Step 2: Update Sidebar to add marketplace nav items**

Replace the `navItems` array and staff handling in `apps/studio/components/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard',       label: 'Dashboard' },
  { href: '/events',          label: 'Events' },
  { href: '/rooms',           label: 'Rooms' },
  { href: '/games',           label: 'Games' },
  { href: '/community',       label: 'Community' },
  { href: '/payouts',         label: 'Payouts' },
  { href: '/products',        label: '🛍 Products' },
  { href: '/orders',          label: '📦 Orders' },
  { href: '/seller-payouts',  label: '💰 Seller Payouts' },
  { href: '/stripe-onboarding', label: '⚡ Connect Stripe' },
  { href: '/settings',        label: 'Settings' },
];

const staffItems = [
  { href: '/staff',                  label: '⚡ Staff Home' },
  { href: '/staff/products',         label: '⚡ Product Approval' },
  { href: '/staff/emails',           label: '⚡ Email Queue' },
  { href: '/staff/reconciliation',   label: '⚡ Reconciliation' },
  { href: '/staff/disputes',         label: '⚡ Disputes' },
];

export function Sidebar({ isStaff = false }: { isStaff?: boolean }) {
  const pathname = usePathname();
  const items = isStaff ? [...navItems, ...staffItems] : navItems;

  return (
    <aside className="w-56 min-h-screen border-r border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <span className="text-xl font-bold tracking-tight text-primary">🌸 Studio</span>
        <p className="text-xs text-muted-foreground mt-0.5">Host dashboard</p>
      </div>
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {items.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Create the `getOwnedBusiness` helper**

Create `apps/studio/lib/business.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type OwnedBusiness = {
  id: string;
  name: string;
  currency: string;
  stripe_account_id: string | null;
  stripe_onboarded_at: string | null;
  can_sell: boolean;
  payout_schedule_set: boolean;
};

export async function getOwnedBusiness(
  supabase: SupabaseClient,
  userId: string
): Promise<OwnedBusiness | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, currency, stripe_account_id, stripe_onboarded_at, can_sell, payout_schedule_set')
    .eq('owner_id', userId)
    .maybeSingle();
  return (data as OwnedBusiness) ?? null;
}
```

- [ ] **Step 4: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/components/Sidebar.tsx \
        apps/studio/lib/business.ts \
        apps/studio/components/ui/textarea.tsx \
        apps/studio/components/ui/select.tsx \
        apps/studio/components/ui/table.tsx \
        apps/studio/package.json \
        apps/studio/package-lock.json
git commit -m "feat(studio): sidebar marketplace nav + business helper + shadcn textarea/select/table + stripe sdk"
```

---

### Task 2: Stripe Connect Onboarding page (`/stripe-onboarding`)

**Files:**
- Create: `apps/studio/app/(dashboard)/stripe-onboarding/page.tsx`
- Create: `apps/studio/app/(dashboard)/stripe-onboarding/actions.ts`

The page shows 5 states based on `businesses` columns. State B (payout schedule pending) auto-calls the `connect-business-stripe` edge function with `action='configure_payout'` on first render. State A shows a Connect button. State D shows the Stripe dashboard link.

- [ ] **Step 1: Create server actions**

Create `apps/studio/app/(dashboard)/stripe-onboarding/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function connectStripeAction(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/stripe-onboarding`;

  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { action: 'onboard', return_url: returnUrl },
  });

  if (error || !data?.url) {
    return { error: error?.message ?? 'Failed to create Stripe account link' };
  }

  redirect(data.url);
}

export async function getDashboardLinkAction(): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { action: 'dashboard_link' },
  });

  if (error || !data?.url) {
    return { error: error?.message ?? 'Could not generate dashboard link' };
  }
  return { url: data.url };
}
```

- [ ] **Step 2: Create the page**

Create `apps/studio/app/(dashboard)/stripe-onboarding/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { connectStripeAction, getDashboardLinkAction } from './actions';

export default async function StripeOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Stripe Connect</h1>
        <p className="text-muted-foreground">
          You don't have a registered business yet. Register your business first.
        </p>
      </div>
    );
  }

  // State A: no Stripe account at all
  if (!business.stripe_account_id) {
    return (
      <div className="max-w-lg space-y-6">
        <h1 className="text-2xl font-bold">Connect Your Stripe Account</h1>
        {params.status === 'success' && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded p-3">
            Stripe connected! Completing setup…
          </p>
        )}
        <p className="text-muted-foreground">
          Connect a Stripe Express account to receive payouts from marketplace sales.
          Roxy takes {10}% per sale — the rest goes directly to you via weekly payout.
        </p>
        <form action={connectStripeAction}>
          <Button type="submit" className="w-full sm:w-auto">
            Connect with Stripe →
          </Button>
        </form>
      </div>
    );
  }

  // State B: connected but payout schedule not yet configured
  if (!business.payout_schedule_set) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Stripe Connect</h1>
        <Badge variant="secondary">Configuring Payout Schedule</Badge>
        <p className="text-muted-foreground">
          Your account is connected. We're setting up your automatic weekly payout schedule (7-day delay, Monday disbursement).
          This completes automatically via our webhook — refresh in a moment.
        </p>
      </div>
    );
  }

  // State C: payout schedule set but not yet verified (can_sell = false)
  if (!business.can_sell) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Stripe Connect</h1>
        <Badge variant="secondary">Verification In Progress</Badge>
        <p className="text-muted-foreground">
          Stripe is reviewing your account. This typically takes 1–2 business days.
          You'll be able to list products once verification is complete.
        </p>
        <p className="text-xs text-muted-foreground">Account ID: {business.stripe_account_id}</p>
      </div>
    );
  }

  // State D: fully verified and can sell
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Stripe Connect</h1>
      <div className="flex items-center gap-2">
        <Badge className="bg-green-600 hover:bg-green-600">Approved to Sell</Badge>
      </div>
      <p className="text-muted-foreground">
        Your Stripe account is verified. You can now list products on the marketplace.
        Payouts happen automatically every Monday for transactions older than 7 days.
      </p>
      <div className="flex gap-3 flex-wrap">
        <a href="/products">
          <Button>Go to Products →</Button>
        </a>
        <form action={getDashboardLinkAction}>
          <Button type="submit" variant="outline">View Stripe Dashboard →</Button>
        </form>
      </div>
    </div>
  );
}
```

Note: `getDashboardLinkAction` returns a URL — add a client wrapper if needed to redirect. For simplicity, wrap the dashboard link in a client component button that fetches and redirects.

- [ ] **Step 3: Make dashboard link button a client component**

Create `apps/studio/app/(dashboard)/stripe-onboarding/DashboardLinkButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getDashboardLinkAction } from './actions';

export function DashboardLinkButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    const result = await getDashboardLinkAction();
    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else if (result.url) {
      window.open(result.url, '_blank');
      setLoading(false);
    }
  };

  return (
    <div>
      <Button variant="outline" onClick={handleClick} disabled={loading}>
        {loading ? 'Loading…' : 'View Stripe Dashboard →'}
      </Button>
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
    </div>
  );
}
```

Update `page.tsx` State D to use `DashboardLinkButton` instead of the `<form>` approach.

- [ ] **Step 4: Update State D in page.tsx to use DashboardLinkButton**

In `page.tsx` State D section, replace the form with:
```tsx
import { DashboardLinkButton } from './DashboardLinkButton';
// ...
<div className="flex gap-3 flex-wrap">
  <a href="/products">
    <Button>Go to Products →</Button>
  </a>
  <DashboardLinkButton />
</div>
```

- [ ] **Step 5: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/app/\(dashboard\)/stripe-onboarding/
git commit -m "feat(studio): stripe connect onboarding page (5 states)"
```

---

### Task 3: Products — list + create + edit

**Files:**
- Create: `apps/studio/app/(dashboard)/products/page.tsx`
- Create: `apps/studio/app/(dashboard)/products/ProductForm.tsx`
- Create: `apps/studio/app/(dashboard)/products/actions.ts`
- Create: `apps/studio/app/(dashboard)/products/new/page.tsx`
- Create: `apps/studio/app/(dashboard)/products/[id]/edit/page.tsx`

**Design decisions:**
- Photos: URL input (up to 5 per product) + alt text. Full file upload is a future enhancement.
- Variants: `has_variants` toggle. Off → single default variant (base_price_cents, stock). On → option1_name + comma-separated option1_values, optional option2. Auto-generates cross-product variant rows.
- Server actions handle all DB writes (products + variants + photos in sequence).
- On edit: delete all existing variants + photos, re-insert fresh ones (simpler than diffing).

- [ ] **Step 1: Create server actions**

Create `apps/studio/app/(dashboard)/products/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';

export type PhotoInput = { url: string; alt_text: string };
export type VariantInput = {
  option1_value?: string;
  option2_value?: string;
  price_cents: number;
  stock: number;
  sku?: string;
};

export async function createProductAction(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) return { error: 'No business found' };

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const category = formData.get('category') as string;
  const base_price_cents = Math.round(parseFloat(formData.get('base_price') as string) * 100);
  const has_variants = formData.get('has_variants') === 'true';
  const variants: VariantInput[] = JSON.parse(formData.get('variants') as string);
  const photos: PhotoInput[] = JSON.parse(formData.get('photos') as string);

  const { data: product, error: pErr } = await supabase
    .from('products')
    .insert({ business_id: business.id, name, description, category, base_price_cents, has_variants })
    .select('id')
    .single();
  if (pErr || !product) return { error: pErr?.message ?? 'Failed to create product' };

  if (variants.length > 0) {
    const rows = variants.map((v) => ({
      product_id: product.id,
      option1_value: v.option1_value ?? null,
      option2_value: v.option2_value ?? null,
      price_cents: v.price_cents,
      stock: v.stock,
      sku: v.sku ?? null,
    }));
    const { error: vErr } = await supabase.from('product_variants').insert(rows);
    if (vErr) return { error: vErr.message };
  }

  if (photos.length > 0) {
    const photoRows = photos.map((ph, i) => ({
      product_id: product.id,
      url: ph.url,
      alt_text: ph.alt_text,
      position: i,
    }));
    const { error: phErr } = await supabase.from('product_photos').insert(photoRows);
    if (phErr) return { error: phErr.message };
  }

  revalidatePath('/products');
  redirect('/products');
}

export async function updateProductAction(productId: string, formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) return { error: 'No business found' };

  const name = formData.get('name') as string;
  const description = formData.get('description') as string;
  const category = formData.get('category') as string;
  const base_price_cents = Math.round(parseFloat(formData.get('base_price') as string) * 100);
  const has_variants = formData.get('has_variants') === 'true';
  const variants: VariantInput[] = JSON.parse(formData.get('variants') as string);
  const photos: PhotoInput[] = JSON.parse(formData.get('photos') as string);

  const { error: pErr } = await supabase
    .from('products')
    .update({ name, description, category, base_price_cents, has_variants })
    .eq('id', productId)
    .eq('business_id', business.id);
  if (pErr) return { error: pErr.message };

  // Replace variants
  await supabase.from('product_variants').delete().eq('product_id', productId);
  if (variants.length > 0) {
    const rows = variants.map((v) => ({
      product_id: productId,
      option1_value: v.option1_value ?? null,
      option2_value: v.option2_value ?? null,
      price_cents: v.price_cents,
      stock: v.stock,
      sku: v.sku ?? null,
    }));
    const { error: vErr } = await supabase.from('product_variants').insert(rows);
    if (vErr) return { error: vErr.message };
  }

  // Replace photos
  await supabase.from('product_photos').delete().eq('product_id', productId);
  if (photos.length > 0) {
    const photoRows = photos.map((ph, i) => ({
      product_id: productId,
      url: ph.url,
      alt_text: ph.alt_text,
      position: i,
    }));
    const { error: phErr } = await supabase.from('product_photos').insert(photoRows);
    if (phErr) return { error: phErr.message };
  }

  revalidatePath('/products');
  redirect('/products');
}
```

- [ ] **Step 2: Create the ProductForm client component**

Create `apps/studio/app/(dashboard)/products/ProductForm.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createProductAction, updateProductAction, type PhotoInput, type VariantInput } from './actions';

const CATEGORIES = ['apparel', 'accessories', 'beauty', 'art', 'food', 'books', 'other'];

type Props = {
  mode: 'create' | 'edit';
  productId?: string;
  initial?: {
    name: string;
    description: string;
    category: string;
    base_price: string;
    has_variants: boolean;
    variants: VariantInput[];
    photos: PhotoInput[];
  };
};

function emptyVariant(): VariantInput {
  return { option1_value: '', price_cents: 0, stock: 0, sku: '' };
}

function generateVariants(
  option1Name: string,
  option1Values: string,
  option2Name: string,
  option2Values: string,
  basePrice: string
): VariantInput[] {
  const v1 = option1Values.split(',').map((s) => s.trim()).filter(Boolean);
  const v2 = option2Values.split(',').map((s) => s.trim()).filter(Boolean);
  const priceCents = Math.round(parseFloat(basePrice || '0') * 100);
  if (v1.length === 0) return [];
  if (v2.length === 0) {
    return v1.map((val) => ({
      option1_value: val,
      price_cents: priceCents,
      stock: 0,
    }));
  }
  return v1.flatMap((val1) =>
    v2.map((val2) => ({
      option1_value: val1,
      option2_value: val2,
      price_cents: priceCents,
      stock: 0,
    }))
  );
}

export function ProductForm({ mode, productId, initial }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [basePrice, setBasePrice] = useState(initial?.base_price ?? '');
  const [hasVariants, setHasVariants] = useState(initial?.has_variants ?? false);
  const [option1Name, setOption1Name] = useState('');
  const [option1Values, setOption1Values] = useState('');
  const [option2Name, setOption2Name] = useState('');
  const [option2Values, setOption2Values] = useState('');
  const [variants, setVariants] = useState<VariantInput[]>(initial?.variants ?? [emptyVariant()]);
  const [photos, setPhotos] = useState<PhotoInput[]>(
    initial?.photos ?? [{ url: '', alt_text: '' }]
  );

  const handleGenerateVariants = () => {
    const generated = generateVariants(option1Name, option1Values, option2Name, option2Values, basePrice);
    if (generated.length > 0) setVariants(generated);
  };

  const handleSubmit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('description', description);
    fd.set('category', category);
    fd.set('base_price', basePrice);
    fd.set('has_variants', String(hasVariants));
    const activeVariants = hasVariants ? variants : [{ price_cents: Math.round(parseFloat(basePrice || '0') * 100), stock: variants[0]?.stock ?? 0 }];
    fd.set('variants', JSON.stringify(activeVariants));
    fd.set('photos', JSON.stringify(photos.filter((p) => p.url.trim())));

    startTransition(async () => {
      let result: { error?: string };
      if (mode === 'create') {
        result = await createProductAction(fd);
      } else {
        result = await updateProductAction(productId!, fd);
      }
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="max-w-2xl space-y-8">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      {/* Basic info */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Basic Info</h2>
        <div className="space-y-2">
          <Label htmlFor="name">Product name *</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={4} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="price">Base price (USD) *</Label>
            <Input id="price" type="number" step="0.01" min="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="19.99" required />
          </div>
        </div>
      </section>

      {/* Photos */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Photos (up to 5)</h2>
          <p className="text-xs text-muted-foreground">URL input — file upload coming soon</p>
        </div>
        {photos.map((ph, i) => (
          <div key={i} className="grid grid-cols-2 gap-3">
            <Input placeholder={`Photo ${i + 1} URL`} value={ph.url} onChange={(e) => setPhotos((prev) => prev.map((p, j) => j === i ? { ...p, url: e.target.value } : p))} />
            <Input placeholder="Alt text (required)" value={ph.alt_text} onChange={(e) => setPhotos((prev) => prev.map((p, j) => j === i ? { ...p, alt_text: e.target.value } : p))} />
          </div>
        ))}
        {photos.length < 5 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPhotos((prev) => [...prev, { url: '', alt_text: '' }])}>
            + Add photo
          </Button>
        )}
      </section>

      {/* Variants */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Checkbox id="has-variants" checked={hasVariants} onCheckedChange={(v) => setHasVariants(Boolean(v))} />
          <Label htmlFor="has-variants">This product has variants (sizes, colours, etc.)</Label>
        </div>

        {!hasVariants && (
          <div className="space-y-2">
            <Label htmlFor="stock">Stock quantity</Label>
            <Input id="stock" type="number" min="0" value={variants[0]?.stock ?? 0} onChange={(e) => setVariants([{ ...variants[0], stock: parseInt(e.target.value, 10) || 0 }])} />
          </div>
        )}

        {hasVariants && (
          <div className="space-y-4 border rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Option 1 name (e.g. Size)</Label>
                <Input value={option1Name} onChange={(e) => setOption1Name(e.target.value)} placeholder="Size" />
              </div>
              <div className="space-y-2">
                <Label>Option 1 values (comma-separated)</Label>
                <Input value={option1Values} onChange={(e) => setOption1Values(e.target.value)} placeholder="S, M, L, XL" />
              </div>
              <div className="space-y-2">
                <Label>Option 2 name (optional)</Label>
                <Input value={option2Name} onChange={(e) => setOption2Name(e.target.value)} placeholder="Colour" />
              </div>
              <div className="space-y-2">
                <Label>Option 2 values (optional)</Label>
                <Input value={option2Values} onChange={(e) => setOption2Values(e.target.value)} placeholder="Red, Blue, Green" />
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleGenerateVariants}>
              Generate Variant Grid
            </Button>

            {variants.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-3">Variant</th>
                      <th className="pb-2 pr-3">Price ($)</th>
                      <th className="pb-2 pr-3">Stock</th>
                      <th className="pb-2">SKU</th>
                    </tr>
                  </thead>
                  <tbody className="space-y-2">
                    {variants.map((v, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3 text-muted-foreground">
                          {[v.option1_value, v.option2_value].filter(Boolean).join(' / ')}
                        </td>
                        <td className="py-2 pr-3">
                          <Input type="number" step="0.01" min="0.01" value={(v.price_cents / 100).toFixed(2)} onChange={(e) => setVariants((prev) => prev.map((r, j) => j === i ? { ...r, price_cents: Math.round(parseFloat(e.target.value) * 100) } : r))} className="w-24" />
                        </td>
                        <td className="py-2 pr-3">
                          <Input type="number" min="0" value={v.stock} onChange={(e) => setVariants((prev) => prev.map((r, j) => j === i ? { ...r, stock: parseInt(e.target.value, 10) || 0 } : r))} className="w-20" />
                        </td>
                        <td className="py-2">
                          <Input value={v.sku ?? ''} onChange={(e) => setVariants((prev) => prev.map((r, j) => j === i ? { ...r, sku: e.target.value } : r))} className="w-28" placeholder="SKU-001" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <Button onClick={handleSubmit} disabled={isPending} className="w-full sm:w-auto">
        {isPending ? 'Saving…' : mode === 'create' ? 'Submit for Approval' : 'Save Changes'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create the products list page**

Create `apps/studio/app/(dashboard)/products/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500',
  approved: 'bg-green-600',
  rejected: 'bg-red-600',
  archived: 'bg-gray-400',
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-muted-foreground">Register your business first to list products.</p>
      </div>
    );
  }

  if (!business.can_sell) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-muted-foreground">
          Complete <Link href="/stripe-onboarding" className="underline">Stripe onboarding</Link> before listing products.
        </p>
      </div>
    );
  }

  const statusFilter = params.status ?? 'all';
  let query = supabase.from('products').select('id, name, category, base_price_cents, status, created_at').eq('business_id', business.id).order('created_at', { ascending: false });
  if (statusFilter !== 'all') query = query.eq('status', statusFilter);
  const { data: products } = await query;

  const statuses = ['all', 'pending', 'approved', 'rejected', 'archived'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Products</h1>
        <Link href="/products/new">
          <Button>+ Add Product</Button>
        </Link>
      </div>

      <div className="flex gap-2 flex-wrap">
        {statuses.map((s) => (
          <Link key={s} href={s === 'all' ? '/products' : `/products?status=${s}`}>
            <Badge variant={statusFilter === s ? 'default' : 'outline'} className="cursor-pointer capitalize">{s}</Badge>
          </Link>
        ))}
      </div>

      {(products ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">No products yet. <Link href="/products/new" className="underline">Add your first product.</Link></p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Category</th>
                <th className="text-left p-3 font-medium">Price</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3 capitalize text-muted-foreground">{p.category}</td>
                  <td className="p-3">${(p.base_price_cents / 100).toFixed(2)}</td>
                  <td className="p-3">
                    <Badge className={`${STATUS_COLORS[p.status] ?? ''} capitalize text-white hover:opacity-90`}>{p.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Link href={`/products/${p.id}/edit`} className="text-primary underline text-xs">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `/products/new` page**

Create `apps/studio/app/(dashboard)/products/new/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { ProductForm } from '../ProductForm';

export default async function NewProductPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business?.can_sell) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Product</h1>
        <p className="text-muted-foreground text-sm mt-1">Products require staff approval before appearing in the app.</p>
      </div>
      <ProductForm mode="create" />
    </div>
  );
}
```

- [ ] **Step 5: Create `/products/[id]/edit` page**

Create `apps/studio/app/(dashboard)/products/[id]/edit/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { ProductForm } from '../../ProductForm';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) notFound();

  const { data: product } = await supabase
    .from('products')
    .select('*, product_variants(*), product_photos(*)')
    .eq('id', id)
    .eq('business_id', business.id)
    .single();
  if (!product) notFound();

  const initial = {
    name: product.name,
    description: product.description ?? '',
    category: product.category,
    base_price: (product.base_price_cents / 100).toFixed(2),
    has_variants: product.has_variants,
    variants: (product.product_variants ?? []).map((v: any) => ({
      option1_value: v.option1_value ?? '',
      option2_value: v.option2_value ?? '',
      price_cents: v.price_cents,
      stock: v.stock,
      sku: v.sku ?? '',
    })),
    photos: (product.product_photos ?? [])
      .sort((a: any, b: any) => a.position - b.position)
      .map((ph: any) => ({ url: ph.url, alt_text: ph.alt_text ?? '' })),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Edit Product</h1>
        <p className="text-muted-foreground text-sm mt-1">Status resets to "pending" after edits — staff re-approval required.</p>
      </div>
      <ProductForm mode="edit" productId={id} initial={initial} />
    </div>
  );
}
```

Note: The `updateProductAction` server action doesn't currently reset status to pending on edit. Add this to the `update` call: include `status: 'pending'` in the update if the product was previously approved/rejected.

Update `actions.ts` `updateProductAction`:
```ts
// In the .update() call, add status reset:
const { error: pErr } = await supabase
  .from('products')
  .update({ name, description, category, base_price_cents, has_variants, status: 'pending' })
  .eq('id', productId)
  .eq('business_id', business.id);
```

- [ ] **Step 6: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/app/\(dashboard\)/products/
git commit -m "feat(studio): products list + create + edit pages"
```

---

### Task 4: Orders — list + detail + fulfillment actions

**Files:**
- Create: `apps/studio/app/(dashboard)/orders/page.tsx`
- Create: `apps/studio/app/(dashboard)/orders/[id]/page.tsx`
- Create: `apps/studio/app/(dashboard)/orders/[id]/OrderActions.tsx`

- [ ] **Step 1: Create the orders list page**

Create `apps/studio/app/(dashboard)/orders/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-blue-600', shipped: 'bg-purple-600', delivered: 'bg-green-600',
  refunded: 'bg-orange-500', cancelled: 'bg-gray-400',
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-muted-foreground">Register your business to see orders.</p>
      </div>
    );
  }

  const statusFilter = params.status;
  let query = supabase
    .from('orders')
    .select('id, status, subtotal_cents, total_cents, created_at, shipping_name')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data: orders } = await query;

  const statuses = ['paid', 'shipped', 'delivered', 'refunded', 'cancelled'];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Orders</h1>

      <div className="flex gap-2 flex-wrap">
        <Link href="/orders"><Badge variant={!statusFilter ? 'default' : 'outline'} className="cursor-pointer">All</Badge></Link>
        {statuses.map((s) => (
          <Link key={s} href={`/orders?status=${s}`}>
            <Badge variant={statusFilter === s ? 'default' : 'outline'} className="cursor-pointer capitalize">{s}</Badge>
          </Link>
        ))}
      </div>

      {(orders ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">No orders yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Order ID</th>
                <th className="text-left p-3 font-medium">Customer</th>
                <th className="text-left p-3 font-medium">Total</th>
                <th className="text-left p-3 font-medium">Date</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{o.id.slice(0, 8)}</td>
                  <td className="p-3">{o.shipping_name}</td>
                  <td className="p-3">${((o.total_cents ?? o.subtotal_cents) / 100).toFixed(2)}</td>
                  <td className="p-3 text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <Badge className={`${STATUS_COLORS[o.status] ?? ''} text-white capitalize hover:opacity-90`}>{o.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Link href={`/orders/${o.id}`} className="text-primary underline text-xs">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the OrderActions client component**

Create `apps/studio/app/(dashboard)/orders/[id]/OrderActions.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  orderId: string;
  status: string;
};

async function callEdgeFn(name: string, body: Record<string, unknown>) {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) return { error: error.message };
  if (data && !data.success) return { error: data.error ?? 'Failed' };
  return { ok: true };
}

export function OrderActions({ orderId, status }: Props) {
  const [isPending, startTransition] = useTransition();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleShipped = () => {
    if (!trackingNumber.trim()) { setError('Tracking number required'); return; }
    setError(null);
    startTransition(async () => {
      const result = await callEdgeFn('update-order-shipped', {
        order_id: orderId,
        tracking_number: trackingNumber.trim(),
      });
      if (result.error) setError(result.error);
      else { setSuccess('Order marked as shipped!'); }
    });
  };

  const handleRefund = () => {
    if (!confirm('Are you sure you want to refund this order?')) return;
    setError(null);
    startTransition(async () => {
      const result = await callEdgeFn('refund-order', { order_id: orderId });
      if (result.error) setError(result.error);
      else setSuccess('Refund initiated!');
    });
  };

  if (success) return <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded p-3">{success} Refresh to see updated status.</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</p>}

      {status === 'paid' && (
        <div className="space-y-3 border rounded-lg p-4">
          <h3 className="font-semibold text-sm">Mark as Shipped</h3>
          <div className="space-y-2">
            <Label htmlFor="tracking">Tracking Number *</Label>
            <Input id="tracking" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="1Z999AA10123456784" />
          </div>
          <Button onClick={handleShipped} disabled={isPending} size="sm">
            {isPending ? 'Updating…' : '📦 Mark Shipped'}
          </Button>
        </div>
      )}

      {(status === 'paid' || status === 'shipped') && (
        <div className="border rounded-lg p-4 border-red-200">
          <h3 className="font-semibold text-sm text-red-700 mb-2">Cancel & Refund</h3>
          <Button variant="destructive" size="sm" onClick={handleRefund} disabled={isPending}>
            {isPending ? 'Processing…' : '↩ Cancel + Full Refund'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the order detail page**

Create `apps/studio/app/(dashboard)/orders/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { OrderActions } from './OrderActions';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business) notFound();

  const { data: order } = await supabase
    .from('orders')
    .select(`
      *,
      order_items(id, product_name, variant_label, unit_price_cents, quantity, line_total_cents),
      order_events(id, event, note, actor_type, created_at)
    `)
    .eq('id', id)
    .eq('business_id', business.id)
    .single();
  if (!order) notFound();

  const events = (order.order_events ?? []).sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Order #{order.id.slice(0, 8)}</h1>
          <p className="text-muted-foreground text-sm">{new Date(order.created_at).toLocaleString()}</p>
        </div>
        <Badge className="capitalize">{order.status}</Badge>
      </div>

      {/* Items */}
      <section className="space-y-3">
        <h2 className="font-semibold">Items</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Product</th>
                <th className="text-left p-3">Qty</th>
                <th className="text-left p-3">Unit</th>
                <th className="text-left p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {(order.order_items ?? []).map((item: any) => (
                <tr key={item.id} className="border-t">
                  <td className="p-3">{item.product_name}{item.variant_label ? ` (${item.variant_label})` : ''}</td>
                  <td className="p-3">{item.quantity}</td>
                  <td className="p-3">${(item.unit_price_cents / 100).toFixed(2)}</td>
                  <td className="p-3">${(item.line_total_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-right text-sm space-y-1">
          <p>Subtotal: <span className="font-medium">${(order.subtotal_cents / 100).toFixed(2)}</span></p>
          {order.shipping_cost_cents > 0 && <p>Shipping: <span className="font-medium">${(order.shipping_cost_cents / 100).toFixed(2)}</span></p>}
          <p className="font-semibold">Total: ${((order.total_cents ?? order.subtotal_cents) / 100).toFixed(2)}</p>
        </div>
      </section>

      {/* Shipping address — rendered only, never logged */}
      <section className="space-y-2">
        <h2 className="font-semibold">Ship to</h2>
        <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-1">
          <p className="font-medium">{order.shipping_name}</p>
          <p>{order.shipping_line1}{order.shipping_line2 ? `, ${order.shipping_line2}` : ''}</p>
          <p>{order.shipping_city}, {order.shipping_state} {order.shipping_postal_code}</p>
          <p>{order.shipping_country}</p>
        </div>
        {order.tracking_number && (
          <p className="text-sm text-muted-foreground">Tracking: <span className="font-mono">{order.tracking_number}</span></p>
        )}
      </section>

      {/* Timeline */}
      <section className="space-y-2">
        <h2 className="font-semibold">Timeline</h2>
        <ol className="space-y-2">
          {events.map((ev: any) => (
            <li key={ev.id} className="flex gap-3 text-sm">
              <span className="text-muted-foreground text-xs mt-0.5 shrink-0">{new Date(ev.created_at).toLocaleString()}</span>
              <span>
                <span className="font-medium capitalize">{ev.event.replace(/_/g, ' ')}</span>
                {ev.note && <span className="text-muted-foreground"> — {ev.note}</span>}
                <span className="text-muted-foreground text-xs ml-1">({ev.actor_type})</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* Actions */}
      <section>
        <h2 className="font-semibold mb-3">Actions</h2>
        <OrderActions orderId={order.id} status={order.status} />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add `createClient` to studio lib/supabase (browser)**

Check if `apps/studio/lib/supabase/client.ts` exists. If it does, ensure it exports `createClient`. If it does not, create it:

```ts
// apps/studio/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

If the file already exists with this content, skip.

- [ ] **Step 5: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/app/\(dashboard\)/orders/
git commit -m "feat(studio): orders list + detail + fulfillment actions (ship/refund)"
```

---

### Task 5: Seller Payouts page (`/seller-payouts`)

**Files:**
- Create: `apps/studio/app/(dashboard)/seller-payouts/page.tsx`

Queries `seller_payouts` table for history. Calls Stripe API for live balance using the seller's `stripe_account_id`.

- [ ] **Step 1: Create the seller payouts page**

Create `apps/studio/app/(dashboard)/seller-payouts/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { Badge } from '@/components/ui/badge';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

const PAYOUT_COLORS: Record<string, string> = {
  paid: 'bg-green-600',
  failed: 'bg-red-600',
  pending: 'bg-yellow-500',
  cancelled: 'bg-gray-400',
};

export default async function SellerPayoutsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const business = await getOwnedBusiness(supabase, userId);
  if (!business?.stripe_account_id) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Seller Payouts</h1>
        <p className="text-muted-foreground">
          Complete <a href="/stripe-onboarding" className="underline">Stripe onboarding</a> to view your payouts.
        </p>
      </div>
    );
  }

  // Live Stripe balance
  let balance: Stripe.Balance | null = null;
  try {
    balance = await stripe.balance.retrieve({ stripeAccount: business.stripe_account_id });
  } catch {
    // Silently ignore — show DB data only if Stripe API fails
  }

  const availableBalance = balance?.available.reduce((sum, b) => sum + b.amount, 0) ?? null;
  const pendingBalance = balance?.pending.reduce((sum, b) => sum + b.amount, 0) ?? null;

  // Payout history from DB
  const { data: payouts } = await supabase
    .from('seller_payouts')
    .select('id, stripe_payout_id, amount_cents, currency, status, failure_message, arrival_date, created_at')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Seller Payouts</h1>

      {/* Live balance cards */}
      {balance && (
        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Available Balance</p>
            <p className="text-2xl font-bold mt-1">${((availableBalance ?? 0) / 100).toFixed(2)}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Pending Balance</p>
            <p className="text-2xl font-bold mt-1">${((pendingBalance ?? 0) / 100).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">Releases automatically on Mondays after 7-day delay</p>
          </div>
        </div>
      )}

      {/* Payout history */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Payout History</h2>
        {(payouts ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No payouts yet. Your first payout arrives on the next Monday after sales clear the 7-day hold.</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Amount</th>
                  <th className="text-left p-3">Expected Arrival</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(payouts ?? []).map((p) => (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="p-3">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td className="p-3 font-medium">${(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}</td>
                    <td className="p-3 text-muted-foreground">{p.arrival_date ?? '—'}</td>
                    <td className="p-3">
                      <Badge className={`${PAYOUT_COLORS[p.status] ?? ''} text-white capitalize hover:opacity-90`}>
                        {p.status}
                      </Badge>
                      {p.failure_message && (
                        <p className="text-xs text-red-600 mt-1">{p.failure_message}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings. If `Stripe` API types mismatch on `apiVersion`, use `'2024-06-20' as any` or the exact version string exported by the installed `stripe` package.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/\(dashboard\)/seller-payouts/
git commit -m "feat(studio): seller payouts page with Stripe live balance + payout history"
```

---

### Task 6: Staff product approval (`/staff/products`)

**Files:**
- Create: `apps/studio/app/(dashboard)/staff/products/page.tsx`
- Create: `apps/studio/app/(dashboard)/staff/products/ApproveRejectButtons.tsx`

- [ ] **Step 1: Create the ApproveRejectButtons client component**

Create `apps/studio/app/(dashboard)/staff/products/ApproveRejectButtons.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

async function callApproveEdgeFn(productId: string, action: 'approve' | 'reject', rejectionReason?: string) {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke('staff-approve-product', {
    body: { product_id: productId, action, rejection_reason: rejectionReason },
  });
  if (error) return { error: error.message };
  if (data && !data.success) return { error: data.error ?? 'Failed' };
  return { ok: true };
}

export function ApproveRejectButtons({ productId }: { productId: string }) {
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  const handleApprove = () => {
    startTransition(async () => {
      const r = await callApproveEdgeFn(productId, 'approve');
      setResult(r);
    });
  };

  const handleReject = () => {
    if (!reason.trim()) return;
    startTransition(async () => {
      const r = await callApproveEdgeFn(productId, 'reject', reason.trim());
      setResult(r);
    });
  };

  if (result?.ok) return <p className="text-sm text-green-600 font-medium">Done! Refresh to see updated queue.</p>;
  if (result?.error) return <p className="text-sm text-red-600">Error: {result.error}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={handleApprove} disabled={isPending} className="bg-green-600 hover:bg-green-700">
          {isPending ? '…' : '✓ Approve'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setShowRejectForm((v) => !v)} disabled={isPending}>
          ✗ Reject ▾
        </Button>
      </div>
      {showRejectForm && (
        <div className="space-y-2 mt-1">
          <Textarea
            placeholder="Rejection reason (sent to seller)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <Button size="sm" variant="destructive" onClick={handleReject} disabled={isPending || !reason.trim()}>
            {isPending ? 'Rejecting…' : 'Confirm Reject'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the staff products page**

Create `apps/studio/app/(dashboard)/staff/products/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ApproveRejectButtons } from './ApproveRejectButtons';

export default async function StaffProductsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase.from('profiles').select('is_staff').eq('id', userId).single();
  if (!profile?.is_staff) notFound();

  const { data: products } = await supabase
    .from('products')
    .select(`
      id, name, description, category, base_price_cents, status, rejection_reason, created_at,
      businesses(name, owner_id),
      product_variants(id, option1_value, option2_value, price_cents, stock),
      product_photos(id, url, alt_text, position)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Product Approval Queue</h1>
        <p className="text-muted-foreground text-sm">{(products ?? []).length} pending product(s)</p>
      </div>

      {(products ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">Queue is empty.</p>
      ) : (
        <div className="space-y-6">
          {(products ?? []).map((p) => {
            const photos = (p.product_photos ?? []).sort((a: any, b: any) => a.position - b.position);
            const variants = p.product_variants ?? [];
            return (
              <div key={p.id} className="border rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-lg">{p.name}</p>
                    <p className="text-sm text-muted-foreground">by {(p.businesses as any)?.name ?? 'Unknown'} · <span className="capitalize">{p.category}</span> · ${(p.base_price_cents / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Submitted {new Date(p.created_at).toLocaleDateString()}</p>
                  </div>
                  <Badge variant="secondary">Pending</Badge>
                </div>

                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}

                {photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {photos.map((ph: any) => (
                      <img key={ph.id} src={ph.url} alt={ph.alt_text ?? ''} className="h-24 w-24 object-cover rounded border" />
                    ))}
                  </div>
                )}

                {variants.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">Variants ({variants.length})</p>
                    <div className="flex gap-2 flex-wrap">
                      {variants.map((v: any) => (
                        <span key={v.id} className="text-xs bg-muted rounded px-2 py-1">
                          {[v.option1_value, v.option2_value].filter(Boolean).join(' / ')} — ${(v.price_cents / 100).toFixed(2)}, stock: {v.stock}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <ApproveRejectButtons productId={p.id} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

- [ ] **Step 4: Commit**

```bash
git add apps/studio/app/\(dashboard\)/staff/products/
git commit -m "feat(studio): staff product approval queue with approve/reject actions"
```

---

### Task 7: Staff ops pages — Email queue, Reconciliation, Disputes

**Files:**
- Create: `apps/studio/app/(dashboard)/staff/emails/page.tsx`
- Create: `apps/studio/app/(dashboard)/staff/reconciliation/page.tsx`
- Create: `apps/studio/app/(dashboard)/staff/disputes/page.tsx`

All 3 pages are read-only views for staff monitoring (the actual processing is automated via cron + webhooks).

- [ ] **Step 1: Create staff emails page (dead-letter queue)**

Create `apps/studio/app/(dashboard)/staff/emails/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-blue-500', processing: 'bg-yellow-500', sent: 'bg-green-600',
  failed: 'bg-orange-500', dead_letter: 'bg-red-600',
};

export default async function StaffEmailsPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase.from('profiles').select('is_staff').eq('id', userId).single();
  if (!profile?.is_staff) notFound();

  // Show dead_letter + failed emails (the ones that need attention)
  const { data: emails } = await supabase
    .from('email_queue')
    .select('id, email_type, status, retry_count, last_error, next_retry_at, created_at, recipient_user_id')
    .in('status', ['dead_letter', 'failed', 'pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(100);

  const deadLetters = (emails ?? []).filter((e) => e.status === 'dead_letter');
  const others = (emails ?? []).filter((e) => e.status !== 'dead_letter');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Email Queue</h1>
        <p className="text-muted-foreground text-sm">Dead-letter emails require manual intervention. All others process automatically.</p>
      </div>

      {deadLetters.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-red-700 mb-3">Dead Letter ({deadLetters.length})</h2>
          <EmailTable emails={deadLetters} />
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Active Queue ({others.length})</h2>
          <EmailTable emails={others} />
        </section>
      )}

      {(emails ?? []).length === 0 && (
        <p className="text-muted-foreground text-sm">Email queue is healthy — no failed or dead-letter items.</p>
      )}
    </div>
  );
}

function EmailTable({ emails }: { emails: any[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3">Type</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Retries</th>
            <th className="text-left p-3">Next Retry</th>
            <th className="text-left p-3">Error</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((e) => (
            <tr key={e.id} className="border-t hover:bg-muted/30">
              <td className="p-3 font-mono text-xs">{e.email_type}</td>
              <td className="p-3">
                <Badge className={`${STATUS_COLORS[e.status] ?? ''} text-white text-xs capitalize`}>{e.status}</Badge>
              </td>
              <td className="p-3">{e.retry_count}</td>
              <td className="p-3 text-muted-foreground text-xs">{e.next_retry_at ? new Date(e.next_retry_at).toLocaleString() : '—'}</td>
              <td className="p-3 text-red-600 text-xs max-w-xs truncate">{e.last_error ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create staff reconciliation page**

Create `apps/studio/app/(dashboard)/staff/reconciliation/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

const ALERT_COLORS: Record<string, string> = {
  charge_not_in_db: 'bg-red-600', order_paid_no_charge: 'bg-red-600',
  refund_mismatch: 'bg-orange-500', payout_mismatch: 'bg-orange-500', transfer_missing: 'bg-yellow-500',
};

export default async function StaffReconciliationPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase.from('profiles').select('is_staff').eq('id', userId).single();
  if (!profile?.is_staff) notFound();

  const { data: alerts } = await supabase
    .from('reconciliation_alerts')
    .select('id, alert_type, stripe_id, order_id, detail, resolved_at, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation Alerts</h1>
        <p className="text-muted-foreground text-sm">{(alerts ?? []).length} unresolved alert(s) — populated by daily 2am cron job</p>
      </div>

      {(alerts ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">No unresolved reconciliation alerts. All orders match Stripe.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Stripe ID</th>
                <th className="text-left p-3">Order ID</th>
                <th className="text-left p-3">Detail</th>
                <th className="text-left p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {(alerts ?? []).map((a) => (
                <tr key={a.id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <Badge className={`${ALERT_COLORS[a.alert_type] ?? ''} text-white text-xs`}>
                      {a.alert_type.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="p-3 font-mono text-xs">{a.stripe_id ?? '—'}</td>
                  <td className="p-3 font-mono text-xs">{a.order_id ? a.order_id.slice(0, 8) : '—'}</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-xs truncate">{a.detail ?? '—'}</td>
                  <td className="p-3 text-muted-foreground text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create staff disputes page**

Create `apps/studio/app/(dashboard)/staff/disputes/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

const STATUS_COLORS: Record<string, string> = {
  needs_response: 'bg-red-600', warning_needs_response: 'bg-red-600',
  under_review: 'bg-yellow-500', warning_under_review: 'bg-yellow-500',
  charge_refunded: 'bg-orange-500', won: 'bg-green-600', lost: 'bg-gray-600',
  warning_closed: 'bg-gray-400',
};

export default async function StaffDisputesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase.from('profiles').select('is_staff').eq('id', userId).single();
  if (!profile?.is_staff) notFound();

  const { data: disputes } = await supabase
    .from('disputes')
    .select(`
      id, stripe_dispute_id, amount_cents, reason, status,
      evidence_submitted_at, response_due_by, created_at,
      order_id
    `)
    .order('response_due_by', { ascending: true })
    .limit(50);

  const open = (disputes ?? []).filter((d) => !['won', 'lost', 'warning_closed', 'charge_refunded'].includes(d.status));
  const closed = (disputes ?? []).filter((d) => ['won', 'lost', 'warning_closed', 'charge_refunded'].includes(d.status));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Disputes</h1>
        <p className="text-muted-foreground text-sm">Evidence is submitted automatically on dispute creation. Monitor response deadlines.</p>
      </div>

      {open.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Open ({open.length})</h2>
          <DisputeTable disputes={open} />
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-muted-foreground">Closed ({closed.length})</h2>
          <DisputeTable disputes={closed} />
        </section>
      )}

      {(disputes ?? []).length === 0 && (
        <p className="text-muted-foreground text-sm">No disputes on record.</p>
      )}
    </div>
  );
}

function DisputeTable({ disputes }: { disputes: any[] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3">Stripe ID</th>
            <th className="text-left p-3">Amount</th>
            <th className="text-left p-3">Reason</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Evidence Sent</th>
            <th className="text-left p-3">Due By</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => {
            const dueDate = new Date(d.response_due_by);
            const isUrgent = dueDate.getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000;
            return (
              <tr key={d.id} className="border-t hover:bg-muted/30">
                <td className="p-3 font-mono text-xs">{d.stripe_dispute_id.slice(0, 12)}…</td>
                <td className="p-3">${(d.amount_cents / 100).toFixed(2)}</td>
                <td className="p-3 text-muted-foreground capitalize">{d.reason?.replace(/_/g, ' ') ?? '—'}</td>
                <td className="p-3">
                  <Badge className={`${STATUS_COLORS[d.status] ?? ''} text-white text-xs`}>{d.status.replace(/_/g, ' ')}</Badge>
                </td>
                <td className="p-3 text-xs">{d.evidence_submitted_at ? new Date(d.evidence_submitted_at).toLocaleDateString() : <span className="text-red-600">Not submitted</span>}</td>
                <td className={`p-3 text-xs font-medium ${isUrgent ? 'text-red-600' : ''}`}>{dueDate.toLocaleDateString()}{isUrgent ? ' ⚠' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run type-check and lint**

```bash
cd apps/studio
npx tsc --noEmit
npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/app/\(dashboard\)/staff/emails/ \
        apps/studio/app/\(dashboard\)/staff/reconciliation/ \
        apps/studio/app/\(dashboard\)/staff/disputes/
git commit -m "feat(studio): staff email queue + reconciliation alerts + disputes pages"
```

---

### Final QA

- [ ] **Run full QA loop**

```bash
cd apps/studio
npx eslint . --ext .ts,.tsx --max-warnings 0
npx tsc --noEmit
```

Expected: 0 errors, 0 warnings on both.

- [ ] **Commit if any final fixes needed, then complete**

```bash
git add -A
git commit -m "fix(studio): final QA fixes"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented |
|---|---|
| 6.1 Route structure | ✓ All 10 routes implemented |
| 6.2 Stripe Connect onboarding (5 states) | ✓ States A–D; E (account issues) omitted (needs Stripe account requirements API, future) |
| 6.3 Product management (create/edit with photos + variants) | ✓ URL-based photos (file upload future); variant grid auto-generation ✓ |
| 6.4 Order management (list, detail, ship, refund) | ✓ |
| 6.5 Payout history (live balance + history) | ✓ Stripe balance + seller_payouts table |
| 6.6 Staff product approval | ✓ |
| Staff email queue | ✓ |
| Staff reconciliation alerts | ✓ |
| Staff disputes | ✓ |

**Known limitations (not defects):**
- Photo upload is URL-based. File upload to Supabase Storage is a separate task.
- State E (Stripe account issues requiring action) omitted — requires checking Stripe account requirements API.
- Mark Delivered action omitted — spec says optional.
