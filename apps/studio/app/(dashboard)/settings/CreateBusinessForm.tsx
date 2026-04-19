'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBusiness } from './business-actions';

const CATEGORIES = [
  'Beauty & Wellness', 'Fashion & Apparel', 'Food & Beverage', 'Art & Design',
  'Tech & Software', 'Health & Fitness', 'Events & Entertainment', 'Education',
  'Home & Living', 'Media & Publishing', 'Services', 'Other',
];

export function CreateBusinessForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBusiness(formData);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Business name *</Label>
          <Input id="name" name="name" placeholder="e.g. Lavender Books" required maxLength={100} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <select
            id="category"
            name="category"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— Select category —</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="location_city">City</Label>
          <Input id="location_city" name="location_city" placeholder="e.g. New York" maxLength={80} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={500}
            placeholder="Tell the Roxy community what your business is about…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="website_url">Website</Label>
          <Input id="website_url" name="website_url" placeholder="https://yourbusiness.com" type="url" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="instagram_handle">Instagram handle</Label>
          <Input id="instagram_handle" name="instagram_handle" placeholder="@yourbusiness" maxLength={60} />
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            id="is_wlw_owned"
            name="is_wlw_owned"
            className="h-4 w-4 rounded border-input accent-primary"
          />
          <Label htmlFor="is_wlw_owned" className="cursor-pointer font-normal">
            This business is WLW-owned
          </Label>
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Submitting…' : 'Submit Business Application'}
      </Button>

      <p className="text-xs text-muted-foreground">
        Your application will be reviewed by the Roxy team. You&apos;ll receive an email once approved.
      </p>
    </form>
  );
}
