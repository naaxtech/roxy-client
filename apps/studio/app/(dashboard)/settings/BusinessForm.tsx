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

    const ext = (file.name.split('.').pop() ?? file.type.split('/')[1] ?? 'jpg').toLowerCase();
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
    const url = `${urlData.publicUrl}?t=${Date.now()}`;
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
    <form onSubmit={handleSubmit} className="space-y-6">
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
            // eslint-disable-next-line @next/next/no-img-element
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
            {logoUploading ? 'Uploading\u2026' : logoPreview ? 'Change Logo' : 'Upload Logo'}
          </Button>
          <p className="text-xs text-muted-foreground mt-1">PNG, JPG or WebP · max 5 MB</p>
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
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Business name *</Label>
          <Input id="name" name="name" required maxLength={100} defaultValue={business?.name ?? ''} placeholder="e.g. Lavender Books" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <select id="category" name="category" defaultValue={business?.category ?? ''}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
            <option value="">— Select category —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location_city">City</Label>
          <Input id="location_city" name="location_city" maxLength={80} defaultValue={business?.location_city ?? ''} placeholder="e.g. New York" />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} maxLength={500} defaultValue={business?.description ?? ''} placeholder="Tell the Roxy community what your business is about\u2026" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact_email">Contact email</Label>
          <Input id="contact_email" name="contact_email" type="email" maxLength={200} defaultValue={business?.contact_email ?? ''} placeholder="hello@yourbusiness.com" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" maxLength={30} defaultValue={business?.phone ?? ''} placeholder="+1 555 000 0000" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website_url">Website</Label>
          <Input id="website_url" name="website_url" type="url" defaultValue={business?.website_url ?? ''} placeholder="https://yourbusiness.com" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="instagram_handle">Instagram</Label>
          <Input id="instagram_handle" name="instagram_handle" maxLength={60} defaultValue={business?.instagram_handle ?? ''} placeholder="@yourbusiness" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tiktok_handle">TikTok</Label>
          <Input id="tiktok_handle" name="tiktok_handle" maxLength={60} defaultValue={business?.tiktok_handle ?? ''} placeholder="@yourbusiness" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="facebook_url">Facebook URL</Label>
          <Input id="facebook_url" name="facebook_url" type="url" defaultValue={business?.facebook_url ?? ''} placeholder="https://facebook.com/yourbusiness" />
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <Checkbox id="is_wlw_owned" name="is_wlw_owned" checked={isWlwOwned} onCheckedChange={v => setIsWlwOwned(v === true)} />
          <Label htmlFor="is_wlw_owned" className="cursor-pointer font-normal">This business is WLW-owned</Label>
        </div>
      </div>

      <Button type="submit" disabled={pending || logoUploading} className="w-full sm:w-auto">
        {pending ? 'Saving\u2026' : isEdit ? 'Save Changes' : 'Submit Business Application'}
      </Button>

      {!isEdit && (
        <p className="text-xs text-muted-foreground">
          Your application will be reviewed by the Roxy team. You&apos;ll receive an email once approved.
        </p>
      )}
    </form>
  );
}
