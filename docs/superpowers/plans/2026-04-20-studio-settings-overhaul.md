# Studio Settings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Studio Settings page into a complete, enterprise-grade experience covering account management, business profile (create/edit/logo), product Stripe connect (inline), event payments Stripe (fixed), notification preferences, and account deletion.

**Architecture:** Single scrolling settings page (`app/(dashboard)/settings/page.tsx`) fetches all data server-side and passes it to focused client components per section. Server actions in `settings/business-actions.ts` and `settings/account-actions.ts` handle all mutations. A new migration (040) adds missing business columns and the `business-logos` storage bucket.

**Tech Stack:** Next.js 16 App Router · Supabase SSR · shadcn/ui · Supabase Storage (business-logos bucket) · `stripe-connect-onboard` and `connect-business-stripe` edge functions

---

## File Map

**New files:**
- `supabase/migrations/040_settings_improvements.sql` — extra business columns + business-logos bucket
- `apps/studio/app/(dashboard)/settings/account-actions.ts` — updateNotificationPrefs, deleteAccount
- `apps/studio/app/(dashboard)/settings/AccountSection.tsx` — email + sign out
- `apps/studio/app/(dashboard)/settings/BusinessForm.tsx` — unified create/edit with logo upload (replaces CreateBusinessForm.tsx)
- `apps/studio/app/(dashboard)/settings/ProductStripeSection.tsx` — product Stripe connect/status inline
- `apps/studio/app/(dashboard)/settings/NotificationPrefsClient.tsx` — 3 email preference toggles
- `apps/studio/app/(dashboard)/settings/DangerZoneClient.tsx` — delete account confirm dialog
- `apps/studio/__tests__/settings/business-actions.test.ts`
- `apps/studio/__tests__/settings/account-actions.test.ts`
- `apps/studio/__tests__/settings/BusinessForm.test.tsx`

**Modified files:**
- `apps/studio/app/(dashboard)/settings/page.tsx` — full rewrite
- `apps/studio/app/(dashboard)/settings/business-actions.ts` — add updateBusiness, resubmitBusiness, connectBusinessStripe, getBusinessStripeDashboardLink
- `apps/studio/app/(dashboard)/settings/StripeBannerClient.tsx` — replace alert() with inline error state
- `apps/studio/lib/business.ts` — add new fields to OwnedBusiness interface + getOwnedBusinessFull()
- `supabase/functions/connect-business-stripe/index.ts` — return_url → /settings
- `supabase/functions/stripe-connect-onboard/index.ts` — return_url → /settings

**Deleted files:**
- `apps/studio/app/(dashboard)/settings/CreateBusinessForm.tsx` — replaced by BusinessForm.tsx

---

## Task 1: Migration 040 — extra business columns + business-logos bucket

**Files:**
- Create: `supabase/migrations/040_settings_improvements.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/040_settings_improvements.sql
-- Adds contact details + social fields to businesses.
-- Creates business-logos public storage bucket with owner-scoped RLS.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS phone          text,
  ADD COLUMN IF NOT EXISTS tiktok_handle  text,
  ADD COLUMN IF NOT EXISTS facebook_url   text;

-- business-logos bucket (public read, owner write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read logos (public CDN)
CREATE POLICY "business_logos_read_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'business-logos');

-- Authenticated user can upload/update to their own folder
CREATE POLICY "business_logos_upload_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-logos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "business_logos_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-logos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Push migration**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: `Applied 1 migration` (040). If already up-to-date, the `ON CONFLICT DO NOTHING` on the bucket insert prevents errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/040_settings_improvements.sql
git commit -m "feat(studio): migration 040 — extra business fields + business-logos bucket"
```

---

## Task 2: Update lib/business.ts — full business type

**Files:**
- Modify: `apps/studio/lib/business.ts`

- [ ] **Step 1: Write the test**

Create `apps/studio/__tests__/settings/business-lib.test.ts`:

```ts
import { getOwnedBusinessFull } from '@/lib/business';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

const { createClient } = jest.requireMock('@/lib/supabase/server');

describe('getOwnedBusinessFull', () => {
  it('returns null when no user', async () => {
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: null } }) },
    });
    expect(await getOwnedBusinessFull()).toBeNull();
  });

  it('returns full business data for authenticated user', async () => {
    const mockBusiness = {
      id: 'biz-1', name: 'Test Biz', description: 'Desc',
      category: 'Beauty & Wellness', location_city: 'NYC',
      website_url: 'https://test.com', instagram_handle: '@test',
      tiktok_handle: null, facebook_url: null,
      contact_email: null, phone: null,
      logo_url: null, is_verified: false, is_wlw_owned: true,
      business_rejection_reason: null,
      stripe_account_id: null, stripe_onboarded_at: null,
      can_sell: false, payout_schedule_set: false,
    };
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: { sub: 'user-1' } } }) },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: mockBusiness }),
          })),
        })),
      })),
    });
    const result = await getOwnedBusinessFull();
    expect(result?.name).toBe('Test Biz');
    expect(result?.tiktok_handle).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/studio && npx jest __tests__/settings/business-lib.test.ts --no-coverage
```

Expected: `getOwnedBusinessFull is not a function`

- [ ] **Step 3: Update lib/business.ts**

```ts
import { createClient } from '@/lib/supabase/server';

export interface OwnedBusiness {
  id: string;
  name: string;
  stripe_account_id: string | null;
  stripe_onboarded_at: string | null;
  can_sell: boolean;
  is_verified: boolean;
}

export interface OwnedBusinessFull extends OwnedBusiness {
  description: string | null;
  category: string | null;
  location_city: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  facebook_url: string | null;
  contact_email: string | null;
  phone: string | null;
  logo_url: string | null;
  is_wlw_owned: boolean;
  business_rejection_reason: string | null;
  payout_schedule_set: boolean;
}

export async function getOwnedBusiness(): Promise<OwnedBusiness | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('businesses')
    .select('id, name, stripe_account_id, stripe_onboarded_at, can_sell, is_verified')
    .eq('owner_id', userId)
    .maybeSingle();

  return data ?? null;
}

export async function getOwnedBusinessFull(): Promise<OwnedBusinessFull | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from('businesses')
    .select(`
      id, name, description, category, location_city,
      website_url, instagram_handle, tiktok_handle, facebook_url,
      contact_email, phone, logo_url, is_verified, is_wlw_owned,
      business_rejection_reason, stripe_account_id, stripe_onboarded_at,
      can_sell, payout_schedule_set
    `)
    .eq('owner_id', userId)
    .maybeSingle();

  return data ?? null;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/studio && npx jest __tests__/settings/business-lib.test.ts --no-coverage
```

Expected: 2 passing

- [ ] **Step 5: Commit**

```bash
git add apps/studio/lib/business.ts apps/studio/__tests__/settings/business-lib.test.ts
git commit -m "feat(studio): add OwnedBusinessFull type + getOwnedBusinessFull"
```

---

## Task 3: business-actions.ts — add updateBusiness + resubmitBusiness + product Stripe actions

**Files:**
- Modify: `apps/studio/app/(dashboard)/settings/business-actions.ts`
- Create: `apps/studio/__tests__/settings/business-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/studio/__tests__/settings/business-actions.test.ts
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/business', () => ({ getOwnedBusiness: jest.fn(), getOwnedBusinessFull: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server');
const { getOwnedBusiness, getOwnedBusinessFull } = jest.requireMock('@/lib/business');

describe('updateBusiness', () => {
  it('throws if no business', async () => {
    getOwnedBusiness.mockResolvedValue(null);
    const { updateBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    const fd = new FormData();
    fd.set('name', 'Test');
    await expect(updateBusiness('biz-1', fd)).rejects.toThrow('No business found');
  });

  it('updates and clears rejection reason', async () => {
    getOwnedBusiness.mockResolvedValue({ id: 'biz-1' });
    const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) });
    createClient.mockResolvedValue({ from: jest.fn(() => ({ update: mockUpdate })) });
    const { updateBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    const fd = new FormData();
    fd.set('name', 'Updated Name');
    fd.set('base_price_cents', '');
    await updateBusiness('biz-1', fd);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Name', business_rejection_reason: null }));
  });
});

describe('resubmitBusiness', () => {
  it('clears rejection reason for own business', async () => {
    getOwnedBusiness.mockResolvedValue({ id: 'biz-1' });
    const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) });
    createClient.mockResolvedValue({ from: jest.fn(() => ({ update: mockUpdate })) });
    const { resubmitBusiness } = await import('@/app/(dashboard)/settings/business-actions');
    await resubmitBusiness('biz-1');
    expect(mockUpdate).toHaveBeenCalledWith({ business_rejection_reason: null });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/studio && npx jest __tests__/settings/business-actions.test.ts --no-coverage
```

Expected: `updateBusiness is not a function`

- [ ] **Step 3: Rewrite business-actions.ts**

```ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createBusiness(formData: FormData): Promise<{ error?: string }> {
  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Business name is required' };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { error: 'Not authenticated' };

  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (existing) return { error: 'You already have a business registered' };

  const logoUrl = (formData.get('logo_url') as string)?.trim() || null;

  const { error } = await supabase.from('businesses').insert({
    owner_id: userId,
    name,
    description: (formData.get('description') as string)?.trim() || null,
    category: (formData.get('category') as string)?.trim() || null,
    location_city: (formData.get('location_city') as string)?.trim() || null,
    is_wlw_owned: formData.get('is_wlw_owned') === 'on',
    website_url: (formData.get('website_url') as string)?.trim() || null,
    instagram_handle: (formData.get('instagram_handle') as string)?.trim() || null,
    tiktok_handle: (formData.get('tiktok_handle') as string)?.trim() || null,
    facebook_url: (formData.get('facebook_url') as string)?.trim() || null,
    contact_email: (formData.get('contact_email') as string)?.trim() || null,
    phone: (formData.get('phone') as string)?.trim() || null,
    logo_url: logoUrl,
  });

  if (error) return { error: error.message };

  revalidatePath('/settings');
  return {};
}

export async function updateBusiness(businessId: string, formData: FormData): Promise<{ error?: string }> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const name = (formData.get('name') as string)?.trim();
  if (!name) return { error: 'Business name is required' };

  const logoUrl = (formData.get('logo_url') as string)?.trim() || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from('businesses')
    .update({
      name,
      description: (formData.get('description') as string)?.trim() || null,
      category: (formData.get('category') as string)?.trim() || null,
      location_city: (formData.get('location_city') as string)?.trim() || null,
      is_wlw_owned: formData.get('is_wlw_owned') === 'on',
      website_url: (formData.get('website_url') as string)?.trim() || null,
      instagram_handle: (formData.get('instagram_handle') as string)?.trim() || null,
      tiktok_handle: (formData.get('tiktok_handle') as string)?.trim() || null,
      facebook_url: (formData.get('facebook_url') as string)?.trim() || null,
      contact_email: (formData.get('contact_email') as string)?.trim() || null,
      phone: (formData.get('phone') as string)?.trim() || null,
      logo_url: logoUrl,
      // Always clear rejection reason on save — puts back to pending review if was rejected
      business_rejection_reason: null,
    })
    .eq('id', businessId)
    .eq('owner_id', business.id);

  if (error) return { error: error.message };
  revalidatePath('/settings');
  return {};
}

export async function resubmitBusiness(businessId: string): Promise<void> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const supabase = await createClient();
  await supabase
    .from('businesses')
    .update({ business_rejection_reason: null })
    .eq('id', businessId)
    .eq('owner_id', business.id);

  revalidatePath('/settings');
}

export async function connectBusinessStripe(): Promise<never> {
  const business = await getOwnedBusiness();
  if (!business) redirect('/settings');

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id },
  });
  if (error || !data?.url) throw new Error('Failed to start Stripe onboarding');
  redirect(data.url as string);
}

export async function getBusinessStripeDashboardLink(): Promise<string> {
  const business = await getOwnedBusiness();
  if (!business) throw new Error('No business found');

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('connect-business-stripe', {
    body: { business_id: business.id, action: 'dashboard_link' },
  });
  if (error || !data?.url) throw new Error('Failed to get dashboard link');
  return data.url as string;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/studio && npx jest __tests__/settings/business-actions.test.ts --no-coverage
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/business-actions.ts" apps/studio/__tests__/settings/business-actions.test.ts
git commit -m "feat(studio): updateBusiness, resubmitBusiness, product Stripe actions in settings"
```

---

## Task 4: account-actions.ts — updateNotificationPrefs + deleteAccount

**Files:**
- Create: `apps/studio/app/(dashboard)/settings/account-actions.ts`
- Create: `apps/studio/__tests__/settings/account-actions.test.ts`

- [ ] **Step 1: Add SUPABASE_SERVICE_ROLE_KEY to Studio env**

Open `apps/studio/.env.local` and add (get the key from Supabase dashboard → Settings → API → service_role key):
```
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/studio/__tests__/settings/account-actions.test.ts
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server');

describe('updateNotificationPrefs', () => {
  it('merges prefs into profiles.notification_preferences', async () => {
    const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: { sub: 'user-1' } } }) },
      from: jest.fn(() => ({ update: mockUpdate })),
    });
    const { updateNotificationPrefs } = await import('@/app/(dashboard)/settings/account-actions');
    await updateNotificationPrefs({ studio_orders: true, studio_community: false, studio_news: true });
    expect(mockUpdate).toHaveBeenCalledWith({
      notification_preferences: { studio_orders: true, studio_community: false, studio_news: true },
    });
  });
});

describe('deleteAccount', () => {
  it('calls admin.deleteUser and redirects', async () => {
    const mockDeleteUser = jest.fn().mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: { sub: 'user-1' } } }) },
    });
    // Mock @supabase/supabase-js admin client
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn(() => ({
        auth: { admin: { deleteUser: mockDeleteUser } },
      })),
    }));
    const { deleteAccount } = await import('@/app/(dashboard)/settings/account-actions');
    await deleteAccount();
    expect(mockDeleteUser).toHaveBeenCalledWith('user-1');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
cd apps/studio && npx jest __tests__/settings/account-actions.test.ts --no-coverage
```

Expected: module not found

- [ ] **Step 4: Create account-actions.ts**

```ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export interface StudioNotificationPrefs {
  studio_orders: boolean;
  studio_community: boolean;
  studio_news: boolean;
}

export async function updateNotificationPrefs(prefs: StudioNotificationPrefs): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) throw new Error('Not authenticated');

  await supabase
    .from('profiles')
    .update({ notification_preferences: prefs })
    .eq('id', userId);

  revalidatePath('/settings');
}

export async function deleteAccount(): Promise<never> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect('/auth/login');

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!serviceRoleKey) throw new Error('Service role key not configured');

  const adminClient = createAdminClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Failed to delete account: ${error.message}`);

  redirect('/auth/login');
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/studio && npx jest __tests__/settings/account-actions.test.ts --no-coverage
```

Expected: 2 passing

- [ ] **Step 6: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/account-actions.ts" apps/studio/__tests__/settings/account-actions.test.ts
git commit -m "feat(studio): account server actions — updateNotificationPrefs, deleteAccount"
```

---

## Task 5: BusinessForm.tsx — unified create/edit with logo upload

**Files:**
- Create: `apps/studio/app/(dashboard)/settings/BusinessForm.tsx`
- Delete: `apps/studio/app/(dashboard)/settings/CreateBusinessForm.tsx`
- Create: `apps/studio/__tests__/settings/BusinessForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/studio/__tests__/settings/BusinessForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BusinessForm } from '@/app/(dashboard)/settings/BusinessForm';

jest.mock('@/app/(dashboard)/settings/business-actions', () => ({
  createBusiness: jest.fn().mockResolvedValue({}),
  updateBusiness: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://cdn.example.com/logo.jpg' } })),
      })),
    },
  })),
}));

describe('BusinessForm', () => {
  it('renders create mode with empty fields', () => {
    render(<BusinessForm userId="user-1" />);
    expect(screen.getByRole('button', { name: /submit business/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('renders edit mode with pre-filled name', () => {
    render(<BusinessForm userId="user-1" business={{ id: 'biz-1', name: 'Test Biz', description: null, category: null, location_city: null, website_url: null, instagram_handle: null, tiktok_handle: null, facebook_url: null, contact_email: null, phone: null, logo_url: null, is_wlw_owned: false, business_rejection_reason: null, stripe_account_id: null, stripe_onboarded_at: null, can_sell: false, is_verified: false, payout_schedule_set: false }} />);
    expect(screen.getByDisplayValue('Test Biz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('shows error when name is empty', async () => {
    const { createBusiness } = jest.requireMock('@/app/(dashboard)/settings/business-actions');
    createBusiness.mockResolvedValueOnce({ error: 'Business name is required' });
    render(<BusinessForm userId="user-1" />);
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(screen.getByText(/business name is required/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/studio && npx jest __tests__/settings/BusinessForm.test.tsx --no-coverage
```

Expected: `BusinessForm is not a function`

- [ ] **Step 3: Create BusinessForm.tsx**

```tsx
'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { createBusiness, updateBusiness } from './business-actions';
import { createClient } from '@/lib/supabase/client';
import type { OwnedBusinessFull } from '@/lib/business';

const CATEGORIES = [
  'Beauty & Wellness', 'Fashion & Apparel', 'Food & Beverage', 'Art & Design',
  'Tech & Software', 'Health & Fitness', 'Events & Entertainment', 'Education',
  'Home & Living', 'Media & Publishing', 'Services', 'Other',
];

type Props = {
  userId: string;
  business?: OwnedBusinessFull;
  onSuccess?: () => void;
};

export function BusinessForm({ userId, business, onSuccess }: Props) {
  const router = useRouter();
  const isEdit = Boolean(business);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isWlwOwned, setIsWlwOwned] = useState(business?.is_wlw_owned ?? false);
  const [logoPreview, setLogoPreview] = useState<string | null>(business?.logo_url ?? null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(business?.logo_url ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Logo must be under 5 MB'); return; }

    setLogoUploading(true);
    setError(null);

    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${userId}/logo.${ext}`;
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from('business-logos')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      setError(`Logo upload failed: ${uploadError.message}`);
      setLogoUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('business-logos').getPublicUrl(path);
    const url = `${urlData.publicUrl}?t=${Date.now()}`; // cache-bust
    setLogoUrl(url);
    setLogoPreview(url);
    setLogoUploading(false);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    if (isWlwOwned) formData.set('is_wlw_owned', 'on');
    else formData.delete('is_wlw_owned');
    if (logoUrl) formData.set('logo_url', logoUrl);

    startTransition(async () => {
      const result = isEdit && business
        ? await updateBusiness(business.id, formData)
        : await createBusiness(formData);

      if (result?.error) { setError(result.error); return; }
      onSuccess?.();
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Business form" className="space-y-6">
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {/* Logo */}
      <div className="flex items-center gap-4">
        <div
          className="h-16 w-16 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          aria-label="Upload business logo"
        >
          {logoPreview ? (
            <img src={logoPreview} alt="Business logo" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-muted-foreground text-center px-1">Logo</span>
          )}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={logoUploading}
          >
            {logoUploading ? 'Uploading…' : logoPreview ? 'Change Logo' : 'Upload Logo'}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">PNG or JPG · max 5 MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleLogoChange}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Name */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Business name *</Label>
          <Input id="name" name="name" required maxLength={100} defaultValue={business?.name ?? ''} placeholder="e.g. Lavender Books" />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <select id="category" name="category" defaultValue={business?.category ?? ''}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">— Select category —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* City */}
        <div className="space-y-1.5">
          <Label htmlFor="location_city">City</Label>
          <Input id="location_city" name="location_city" maxLength={80} defaultValue={business?.location_city ?? ''} placeholder="e.g. New York" />
        </div>

        {/* Description */}
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} maxLength={500} defaultValue={business?.description ?? ''} placeholder="Tell the Roxy community what your business is about…" />
        </div>

        {/* Contact email */}
        <div className="space-y-1.5">
          <Label htmlFor="contact_email">Contact email</Label>
          <Input id="contact_email" name="contact_email" type="email" maxLength={200} defaultValue={business?.contact_email ?? ''} placeholder="hello@yourbusiness.com" />
        </div>

        {/* Phone */}
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" maxLength={30} defaultValue={business?.phone ?? ''} placeholder="+1 555 000 0000" />
        </div>

        {/* Website */}
        <div className="space-y-1.5">
          <Label htmlFor="website_url">Website</Label>
          <Input id="website_url" name="website_url" type="url" defaultValue={business?.website_url ?? ''} placeholder="https://yourbusiness.com" />
        </div>

        {/* Instagram */}
        <div className="space-y-1.5">
          <Label htmlFor="instagram_handle">Instagram</Label>
          <Input id="instagram_handle" name="instagram_handle" maxLength={60} defaultValue={business?.instagram_handle ?? ''} placeholder="@yourbusiness" />
        </div>

        {/* TikTok */}
        <div className="space-y-1.5">
          <Label htmlFor="tiktok_handle">TikTok</Label>
          <Input id="tiktok_handle" name="tiktok_handle" maxLength={60} defaultValue={business?.tiktok_handle ?? ''} placeholder="@yourbusiness" />
        </div>

        {/* Facebook */}
        <div className="space-y-1.5">
          <Label htmlFor="facebook_url">Facebook URL</Label>
          <Input id="facebook_url" name="facebook_url" type="url" defaultValue={business?.facebook_url ?? ''} placeholder="https://facebook.com/yourbusiness" />
        </div>

        {/* WLW owned */}
        <div className="sm:col-span-2 flex items-center gap-2">
          <Checkbox id="is_wlw_owned" name="is_wlw_owned" checked={isWlwOwned} onCheckedChange={v => setIsWlwOwned(v === true)} />
          <Label htmlFor="is_wlw_owned" className="cursor-pointer font-normal">This business is WLW-owned</Label>
        </div>
      </div>

      <Button type="submit" disabled={pending || logoUploading} className="w-full sm:w-auto">
        {pending ? 'Saving…' : isEdit ? 'Save Changes' : 'Submit Business Application'}
      </Button>

      {!isEdit && (
        <p className="text-xs text-muted-foreground">
          Your application will be reviewed by the Roxy team. You'll receive an email once approved.
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Delete CreateBusinessForm.tsx**

```bash
rm "D:/Nicole/Dev/roxy/roxy-client/apps/studio/app/(dashboard)/settings/CreateBusinessForm.tsx"
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/studio && npx jest __tests__/settings/BusinessForm.test.tsx --no-coverage
```

Expected: 3 passing

- [ ] **Step 6: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/BusinessForm.tsx" apps/studio/__tests__/settings/BusinessForm.test.tsx
git rm "apps/studio/app/(dashboard)/settings/CreateBusinessForm.tsx"
git commit -m "feat(studio): BusinessForm — unified create/edit with logo upload, social fields"
```

---

## Task 6: ProductStripeSection.tsx — inline product Stripe

**Files:**
- Create: `apps/studio/app/(dashboard)/settings/ProductStripeSection.tsx`
- Modify: `supabase/functions/connect-business-stripe/index.ts` — update return URLs

- [ ] **Step 1: Update connect-business-stripe return URLs**

In `supabase/functions/connect-business-stripe/index.ts`, change lines 91–92:

Old:
```ts
    refresh_url: `${STUDIO_URL}/stripe-onboarding?business_id=${business_id}&stripe=refresh`,
    return_url: `${STUDIO_URL}/stripe-onboarding?business_id=${business_id}&stripe=success`,
```

New:
```ts
    refresh_url: `${STUDIO_URL}/settings?product_stripe=refresh`,
    return_url: `${STUDIO_URL}/settings?product_stripe=success`,
```

- [ ] **Step 2: Create ProductStripeSection.tsx**

```tsx
'use client';

import { useTransition, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { connectBusinessStripe, getBusinessStripeDashboardLink } from './business-actions';

type Props = {
  canSell: boolean;
  stripeAccountId: string | null;
  stripeOnboardedAt: string | null;
  returnParam: string | null; // from ?product_stripe= query param
};

export function ProductStripeSection({ canSell, stripeAccountId, stripeOnboardedAt, returnParam }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isComplete = canSell && Boolean(stripeOnboardedAt);
  const hasAccount = Boolean(stripeAccountId);

  const handleConnect = () => {
    setError(null);
    startTransition(async () => {
      try {
        await connectBusinessStripe();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start Stripe setup. Please try again.');
      }
    });
  };

  const handleDashboard = () => {
    setError(null);
    startTransition(async () => {
      try {
        const url = await getBusinessStripeDashboardLink();
        window.location.href = url;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open Stripe dashboard.');
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Product payments</p>
        {isComplete ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
        ) : hasAccount ? (
          <Badge variant="secondary">Setup incomplete</Badge>
        ) : (
          <Badge variant="outline">Not connected</Badge>
        )}
      </div>

      {returnParam === 'success' && !isComplete && (
        <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
          Stripe setup submitted. Your account will activate once Stripe verifies your details (usually a few minutes).
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {isComplete ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Your Stripe account is connected. You can list products and receive payouts.</p>
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleDashboard}>
            {isPending ? 'Opening…' : 'Open Stripe Dashboard'}
          </Button>
        </div>
      ) : hasAccount ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">You started but didn't finish Stripe setup. Complete it to start selling.</p>
          <Button size="sm" disabled={isPending} onClick={handleConnect}>
            {isPending ? 'Redirecting…' : 'Continue Stripe Setup'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Connect a Stripe account to accept payments for your products and receive weekly payouts.</p>
          <Button size="sm" disabled={isPending} onClick={handleConnect}>
            {isPending ? 'Redirecting…' : 'Connect Stripe for Products'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/ProductStripeSection.tsx" supabase/functions/connect-business-stripe/index.ts
git commit -m "feat(studio): ProductStripeSection inline — move product Stripe into Settings"
```

---

## Task 7: Fix StripeBannerClient + stripe-connect-onboard return URL

**Files:**
- Modify: `apps/studio/app/(dashboard)/settings/StripeBannerClient.tsx`
- Modify: `supabase/functions/stripe-connect-onboard/index.ts`

- [ ] **Step 1: Fix StripeBannerClient — replace alert() with inline error**

```tsx
'use client';

import { useState } from 'react';
import { StripeBanner } from '@/components/StripeBanner';

type StripeStatus = 'not_started' | 'incomplete' | 'complete' | 'restricted';

export function StripeBannerClient({ initialStatus }: { initialStatus: StripeStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/onboard', { method: 'POST' });
      const data = await res.json();
      if (data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else {
        setError(data.error ?? 'Stripe setup failed. Please try again.');
        setLoading(false);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <StripeBanner status={initialStatus} onConnect={handleConnect} loading={loading} />
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check StripeBanner component accepts loading prop**

```bash
grep -n "loading\|onConnect" D:/Nicole/Dev/roxy/roxy-client/apps/studio/components/StripeBanner.tsx | head -10
```

If `loading` prop is not accepted by `StripeBanner`, add it:
- Open `apps/studio/components/StripeBanner.tsx`
- Add `loading?: boolean` to props type
- Pass `disabled={loading}` to the connect button

- [ ] **Step 3: Update stripe-connect-onboard return URL**

In `supabase/functions/stripe-connect-onboard/index.ts`, change lines 70–71:

Old:
```ts
    refresh_url: `${STUDIO_URL}/settings?stripe=refresh`,
    return_url: `${STUDIO_URL}/settings?stripe=success`,
```

These are already pointing to `/settings` — no change needed. Verify the param name is consistent (`stripe=success`). ✓

- [ ] **Step 4: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/StripeBannerClient.tsx"
git commit -m "fix(studio): StripeBannerClient — replace alert() with inline error state"
```

---

## Task 8: NotificationPrefsClient.tsx

**Files:**
- Create: `apps/studio/app/(dashboard)/settings/NotificationPrefsClient.tsx`

- [ ] **Step 1: Create NotificationPrefsClient.tsx**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { updateNotificationPrefs, type StudioNotificationPrefs } from './account-actions';

type Props = {
  initialPrefs: StudioNotificationPrefs;
};

const PREFS: { key: keyof StudioNotificationPrefs; label: string; description: string }[] = [
  { key: 'studio_orders', label: 'Order updates', description: 'New orders, shipping confirmations, and refund status' },
  { key: 'studio_community', label: 'Community activity', description: 'New members, event sign-ups, and community milestones' },
  { key: 'studio_news', label: 'Roxy platform news', description: 'Product updates, new features, and platform announcements' },
];

export function NotificationPrefsClient({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<StudioNotificationPrefs>(initialPrefs);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const handleChange = (key: keyof StudioNotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaved(false);
    startTransition(async () => {
      await updateNotificationPrefs(next);
      setSaved(true);
    });
  };

  return (
    <div className="space-y-4">
      {PREFS.map(({ key, label, description }) => (
        <div key={key} className="flex items-start gap-3">
          <Checkbox
            id={key}
            checked={prefs[key]}
            disabled={isPending}
            onCheckedChange={v => handleChange(key, v === true)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={key} className="cursor-pointer font-medium">{label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      ))}
      {saved && <p className="text-xs text-green-600">Preferences saved.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/NotificationPrefsClient.tsx"
git commit -m "feat(studio): NotificationPrefsClient — 3 email preference toggles with auto-save"
```

---

## Task 9: DangerZoneClient.tsx

**Files:**
- Create: `apps/studio/app/(dashboard)/settings/DangerZoneClient.tsx`

- [ ] **Step 1: Create DangerZoneClient.tsx**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { deleteAccount } from './account-actions';

export function DangerZoneClient() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        await deleteAccount();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete account. Please contact support.');
        setShowConfirm(false);
      }
    });
  };

  return (
    <div className="rounded-lg border border-destructive/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-destructive">Delete account</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Permanently deletes your account, business profile, products, and all associated data. This cannot be undone.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {showConfirm ? (
        <div className="flex items-center gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? 'Deleting…' : 'Yes, delete my account'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setShowConfirm(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/50 text-destructive hover:bg-destructive/10"
          onClick={() => setShowConfirm(true)}
        >
          Delete account
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/DangerZoneClient.tsx"
git commit -m "feat(studio): DangerZoneClient — delete account with two-step confirmation"
```

---

## Task 10: Settings page.tsx — full rewrite

**Files:**
- Modify: `apps/studio/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Rewrite page.tsx**

```tsx
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusinessFull } from '@/lib/business';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BusinessForm } from './BusinessForm';
import { ProductStripeSection } from './ProductStripeSection';
import { StripeBannerClient } from './StripeBannerClient';
import { NotificationPrefsClient } from './NotificationPrefsClient';
import { DangerZoneClient } from './DangerZoneClient';
import { signOutAction } from '@/app/auth/signout-action';
import type { StudioNotificationPrefs } from './account-actions';

type StripeStatus = 'not_started' | 'incomplete' | 'complete';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string; product_stripe?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const userId = user.id;
  const userEmail = user.email ?? '';

  const [
    { data: stripeAccount },
    business,
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('host_stripe_accounts')
      .select('stripe_account_id, onboarding_complete')
      .eq('user_id', userId)
      .maybeSingle(),
    getOwnedBusinessFull(),
    supabase
      .from('profiles')
      .select('display_name, notification_preferences')
      .eq('id', userId)
      .maybeSingle(),
  ]);

  let stripeStatus: StripeStatus = 'not_started';
  if (stripeAccount?.onboarding_complete) stripeStatus = 'complete';
  else if (stripeAccount?.stripe_account_id) stripeStatus = 'incomplete';

  const notifPrefs: StudioNotificationPrefs = {
    studio_orders: (profile?.notification_preferences as any)?.studio_orders ?? true,
    studio_community: (profile?.notification_preferences as any)?.studio_community ?? true,
    studio_news: (profile?.notification_preferences as any)?.studio_news ?? true,
  };

  const businessIsRejected = !business?.is_verified && Boolean(business?.business_rejection_reason);
  const businessIsPending = !business?.is_verified && !business?.business_rejection_reason && Boolean(business);
  const businessIsApproved = Boolean(business?.is_verified);

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account, business, and payment settings.</p>
      </div>

      {/* ── Account ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Email</p>
              <p className="text-sm font-medium">{userEmail}</p>
            </div>
            {profile?.display_name && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Display name</p>
                <p className="text-sm font-medium">{profile.display_name}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t">
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">Sign out</Button>
            </form>
            <a
              href={`mailto:support@roxy.app?subject=Password reset&body=User ID: ${userId}`}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Reset password
            </a>
          </div>
        </div>
      </section>

      {/* ── Business Profile ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Business Profile</h2>

        {!business ? (
          <div className="rounded-lg border p-6 space-y-4">
            <div>
              <p className="text-sm font-medium">Register your business</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Submit your business for review. Once approved by the Roxy team, you can list products and connect Stripe for payments.
              </p>
            </div>
            <BusinessForm userId={userId} />
          </div>
        ) : (
          <div className="rounded-lg border p-6 space-y-6">
            {/* Status banner */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {business.logo_url && (
                  <img src={business.logo_url} alt="Business logo" className="h-12 w-12 rounded-lg object-cover border" />
                )}
                <div>
                  <p className="font-semibold">{business.name}</p>
                  {business.category && <p className="text-sm text-muted-foreground">{business.category}</p>}
                  {business.location_city && <p className="text-xs text-muted-foreground">{business.location_city}</p>}
                </div>
              </div>
              {businessIsApproved ? (
                <Badge className="bg-green-100 text-green-800 border-green-200 shrink-0">Approved</Badge>
              ) : businessIsRejected ? (
                <Badge variant="destructive" className="shrink-0">Rejected</Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">Pending review</Badge>
              )}
            </div>

            {/* Rejection reason */}
            {businessIsRejected && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm">
                <p className="font-medium text-destructive">Application rejected</p>
                <p className="text-xs text-muted-foreground mt-0.5">{business.business_rejection_reason}</p>
                <p className="text-xs text-muted-foreground mt-1">Update your details below and save to resubmit for review.</p>
              </div>
            )}

            {/* Pending note */}
            {businessIsPending && (
              <p className="text-xs text-muted-foreground">
                Under review by the Roxy team. You'll receive an email once approved.
              </p>
            )}

            {/* Product Stripe (only when approved) */}
            {businessIsApproved && (
              <div className="border-t pt-4">
                <ProductStripeSection
                  canSell={business.can_sell}
                  stripeAccountId={business.stripe_account_id}
                  stripeOnboardedAt={business.stripe_onboarded_at}
                  returnParam={params.product_stripe ?? null}
                />
              </div>
            )}

            {/* Edit form */}
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-4">Edit business details</p>
              <BusinessForm userId={userId} business={business} />
            </div>
          </div>
        )}
      </section>

      {/* ── Event Payments ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Event Payments</h2>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Connect Stripe to receive payouts from paid event tickets hosted in your communities.
          </p>
          {params.stripe === 'success' && stripeStatus !== 'complete' && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 mb-3">
              Stripe setup submitted. Your account will activate once Stripe verifies your details.
            </p>
          )}
          <StripeBannerClient initialStatus={stripeStatus} />
        </div>
      </section>

      {/* ── Notifications ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Email Notifications</h2>
        <div className="rounded-lg border p-4">
          <NotificationPrefsClient initialPrefs={notifPrefs} />
        </div>
      </section>

      {/* ── Danger Zone ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
        <DangerZoneClient />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/studio/app/(dashboard)/settings/page.tsx"
git commit -m "feat(studio): settings page full rewrite — account, business, payments, notifications, danger zone"
```

---

## Task 11: QA loop

- [ ] **Step 1: TypeScript check**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: 0 errors. Fix any before proceeding.

- [ ] **Step 2: Lint**

```bash
cd apps/studio && npx eslint . --ext .ts,.tsx --max-warnings 0
```

Expected: 0 warnings. Fix any before proceeding.

- [ ] **Step 3: Jest**

```bash
cd apps/studio && npx jest --ci --passWithNoTests
```

Expected: all passing, including new tests from tasks 2–5.

- [ ] **Step 4: Review checklist**

```
[ ] business-logos bucket RLS: authenticated users can only upload to {their-user-id}/* path
[ ] deleteAccount uses service role key (server-side only, not NEXT_PUBLIC_)
[ ] No PII in client-visible error messages
[ ] All buttons have aria-label or visible text
[ ] All form inputs have associated Label with htmlFor
[ ] StripeBannerClient no longer uses alert()
[ ] ProductStripeSection error shown inline (not alert)
[ ] BusinessForm logo upload client-side, URL stored server-side
[ ] resubmit: updateBusiness always clears business_rejection_reason
[ ] SUPABASE_SERVICE_ROLE_KEY added to .env.local (and to Vercel/Netlify env vars)
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(studio): QA pass — settings overhaul complete"
```

---

## Environment Variables Required

Add to `apps/studio/.env.local` and to Netlify/Vercel dashboard:
```
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard → Settings → API → service_role>
```

This is a server-only key. Never prefix with `NEXT_PUBLIC_`.
