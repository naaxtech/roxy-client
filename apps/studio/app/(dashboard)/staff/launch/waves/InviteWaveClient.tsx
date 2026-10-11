'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { todayUtcInputValue } from '@/lib/dates';
import { WAVE_LABEL_MAX, WAVE_MAX_CODES, codesToCsv, validateWave } from '@/lib/inviteWaves';
import { createInviteWave } from './actions';

export interface WaveCommunity {
  id: string;
  name: string;
}

interface Issued {
  communityName: string;
  label: string;
  codes: { code: string; expiresAt: string | null }[];
}

export function InviteWaveClient({ communities }: { communities: WaveCommunity[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [count, setCount] = useState('25');
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const form = { count, label, expiry, communityId };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setCopy('idle');
    const check = validateWave(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const result = await createInviteWave(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIssued({ communityName: result.communityName, label: result.label, codes: result.codes });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the wave. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const csv = issued
    ? codesToCsv(
        issued.codes.map((c) => ({
          code: c.code,
          label: issued.label,
          communityName: issued.communityName,
          expiresAt: c.expiresAt,
        })),
      )
    : '';

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  const n = issued?.codes.length ?? 0;

  return (
    <div className="space-y-6">
      <form noValidate onSubmit={(e) => void submit(e)} className="border rounded-lg p-5 space-y-4" aria-label="Create a wave">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wave-count">How many codes</Label>
            <Input
              id="wave-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={WAVE_MAX_CODES}
              step={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">1 to {WAVE_MAX_CODES}. Each code admits one woman.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wave-label">Wave label</Label>
            <Input
              id="wave-label"
              value={label}
              maxLength={WAVE_LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Wave 1 — Pride picnic"
            />
            <p className="text-xs text-muted-foreground">The launch funnel counts redemptions by this label.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wave-expiry">Expires (end of day, UTC)</Label>
            <Input
              id="wave-expiry"
              type="date"
              min={todayUtcInputValue()}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wave-community">Community</Label>
            <Select id="wave-community" value={communityId} onChange={(e) => setCommunityId(e.target.value)}>
              <option value="">Roxy Official (default)</option>
              {communities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">Her application goes to this community.</p>
          </div>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create codes'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      <div role="status" aria-live="polite" className="text-sm">
        {issued && `${n} code${n === 1 ? '' : 's'} created for ${issued.communityName} — “${issued.label}”. Copy them now.`}
      </div>

      {issued && (
        <section className="border rounded-lg p-5 space-y-3" aria-label="New codes">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void copyAll()} aria-label={`Copy all ${n} code${n === 1 ? '' : 's'} as CSV`}>
              {copy === 'copied' ? 'Copied' : 'Copy all as CSV'}
            </Button>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
              download={`roxy-${issued.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`}
              className="text-sm underline"
            >
              Download CSV
            </a>
            {copy === 'failed' && (
              <span className="text-xs text-destructive">Copy did not work — use Download CSV instead.</span>
            )}
          </div>
          <ul className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4 font-mono text-sm">
            {issued.codes.map((c) => (
              <li key={c.code} className="border rounded px-2 py-1 select-all">
                {c.code}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
