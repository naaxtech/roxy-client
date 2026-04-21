'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Community {
  id: string;
  name: string;
}

interface CreateEventFormProps {
  communities: Community[];
  stripeConnected: boolean;
}

const MAX_PRICE_DOLLARS = 50;

export function CreateEventForm({ communities, stripeConnected }: CreateEventFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [priceDollars, setPriceDollars] = useState('');
  const [payoutDelayDays, setPayoutDelayDays] = useState('7');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError('Title is required'); return; }
    if (!communityId) { setError('Select a community'); return; }
    if (!startsAt) { setError('Start time is required'); return; }

    let price_cents: number | null = null;
    if (isPaid) {
      const dollars = parseFloat(priceDollars);
      if (isNaN(dollars) || dollars <= 0) { setError('Enter a valid price'); return; }
      if (dollars > MAX_PRICE_DOLLARS) {
        setError(`Exceeds platform maximum ($${MAX_PRICE_DOLLARS})`);
        return;
      }
      price_cents = Math.round(dollars * 100);
    }

    setLoading(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from('events').insert({
      title: title.trim(),
      community_id: communityId,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      description: description.trim() || null,
      location_text: locationText.trim() || null,
      is_paid: isPaid,
      price_cents,
      currency: 'usd',
      payout_delay_days: isPaid ? parseInt(payoutDelayDays, 10) : null,
    });

    setLoading(false);
    if (insertError) {
      setError(insertError.message);
    } else {
      setTitle(''); setDescription(''); setStartsAt(''); setEndsAt(''); setLocationText('');
      setIsPaid(false); setPriceDollars(''); setPayoutDelayDays('7');
      setSuccessMsg('Event created successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-6 bg-card">
      <h2 className="text-lg font-semibold">Create Event</h2>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {successMsg && (
        <p className="text-sm text-green-600 font-medium bg-green-50 border border-green-200 rounded-md px-3 py-2">
          ✓ {successMsg}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Tell attendees what to expect…"
          rows={3}
          className="resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="community">Community</Label>
        <select
          id="community"
          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={communityId}
          onChange={e => setCommunityId(e.target.value)}
        >
          {communities.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="starts">Start</Label>
          <Input
            id="starts"
            type="datetime-local"
            value={startsAt}
            onChange={e => setStartsAt(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ends">End (optional)</Label>
          <Input
            id="ends"
            type="datetime-local"
            value={endsAt}
            onChange={e => setEndsAt(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="location">Location (optional)</Label>
        <Input
          id="location"
          value={locationText}
          onChange={e => setLocationText(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="isPaid"
          checked={isPaid}
          disabled={!stripeConnected}
          onChange={e => setIsPaid(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="isPaid">
          Paid event
          {!stripeConnected && (
            <span className="text-muted-foreground text-xs ml-2">
              (Connect Stripe in Settings first)
            </span>
          )}
        </Label>
      </div>

      {isPaid && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="price">Price (USD, max ${MAX_PRICE_DOLLARS})</Label>
            <Input
              id="price"
              type="number"
              min="0.50"
              max={MAX_PRICE_DOLLARS}
              step="0.01"
              value={priceDollars}
              onChange={e => setPriceDollars(e.target.value)}
              placeholder="e.g. 10.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payoutDelay">Payout delay (days)</Label>
            <select
              id="payoutDelay"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={payoutDelayDays}
              onChange={e => setPayoutDelayDays(e.target.value)}
            >
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
        </div>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating…' : 'Create Event'}
      </Button>
    </form>
  );
}
