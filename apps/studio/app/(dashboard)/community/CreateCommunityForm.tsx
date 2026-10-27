'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  LOCATION_NOT_SAVED_AFTER_CREATE,
  MEETS_OPTIONS,
  NEEDS_CITY_MESSAGE,
  isMeets,
  missingCityFor,
  needsLocationCall,
  type CityOption,
  type Meets,
} from '@/lib/communityLocation';
import { CityCombobox } from './CityCombobox';

const CATEGORIES = [
  { value: 'identity', label: 'Identity' },
  { value: 'interest', label: 'Interest' },
  { value: 'location', label: 'Location' },
  { value: 'support', label: 'Support' },
] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function CreateCommunityForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('interest');
  const [isPrivate, setIsPrivate] = useState(false);
  const [city, setCity] = useState<CityOption | null>(null);
  const [meets, setMeets] = useState<Meets>('online');
  // Remounts the city field after a create so the text she typed clears too.
  const [cityFieldKey, setCityFieldKey] = useState(0);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLocationWarning(null);

    if (!name.trim()) { setError('Name is required'); return; }
    if (missingCityFor(city, meets)) { setError(NEEDS_CITY_MESSAGE); return; }

    setLoading(true);
    const supabase = createClient();
    const { data: created, error: rpcError } = await supabase.rpc('create_community', {
      p_name: name.trim(),
      p_slug: slugify(name),
      p_description: description.trim() || null,
      p_category: category,
      p_is_private: isPrivate,
    });

    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }

    // create_community (132) knows nothing about place; migration 139 sets it in a
    // second call. If that one fails, the community still exists, safely online.
    let locationSaved = true;
    if (needsLocationCall(city, meets)) {
      const communityId = (created as { id?: unknown } | null)?.id;
      if (typeof communityId === 'string') {
        const { error: locationError } = await supabase.rpc('set_community_location', {
          p_community_id: communityId,
          p_city_id: city?.id ?? null,
          p_meets: meets,
        });
        locationSaved = !locationError;
      } else {
        locationSaved = false;
      }
    }

    setLoading(false);
    setName(''); setDescription(''); setCategory('interest'); setIsPrivate(false);
    setCity(null); setMeets('online'); setCityFieldKey((key) => key + 1);
    if (locationSaved) {
      setSuccessMsg('Community created — you\'re its admin.');
      setTimeout(() => setSuccessMsg(null), 4000);
    } else {
      setSuccessMsg(null);
      setLocationWarning(LOCATION_NOT_SAVED_AFTER_CREATE);
    }
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-6 bg-card">
      <h2 className="text-lg font-semibold">Start a community</h2>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {locationWarning && (
        <p
          role="alert"
          className="text-sm text-foreground bg-muted/50 border border-border border-l-[3px] border-l-amber-700 rounded-md px-3 py-2"
        >
          {locationWarning}
        </p>
      )}
      {successMsg && (
        <p className="text-sm text-green-600 font-medium bg-green-50 border border-green-200 rounded-md px-3 py-2">
          ✓ {successMsg}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What's this community for?"
          rows={3}
          maxLength={500}
          className="resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">Category</Label>
        <select
          id="category"
          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={category}
          onChange={e => setCategory(e.target.value as typeof category)}
        >
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>

      <CityCombobox key={cityFieldKey} id="city" value={city} onChange={setCity} disabled={loading} />

      <div className="space-y-1.5">
        <Label htmlFor="meets">Meets</Label>
        <Select
          id="meets"
          value={meets}
          disabled={loading}
          aria-describedby="meets-hint"
          onChange={(e) => {
            if (isMeets(e.target.value)) setMeets(e.target.value);
          }}
        >
          {MEETS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
        <p id="meets-hint" className="text-xs text-muted-foreground">
          Communities that meet in person show up for members nearby, so they need a city.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="isPrivate"
          checked={isPrivate}
          onChange={e => setIsPrivate(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="isPrivate">Private (invite-only, hidden from public discovery)</Label>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create Community'}
      </Button>
    </form>
  );
}
