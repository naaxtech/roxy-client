'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CopyButton } from '@/components/CopyButton';

/**
 * Core staff only (G-22): a single-use code for an App Store / Play reviewer's
 * seed account. mint_review_code (migration 134) refuses anyone but core. The
 * code joins Roxy Official and only opens an application; approve it in the
 * review queue. Runbook: docs/ops/store-review-account.md.
 */
export function ReviewCodeMint() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const supabase = createClient();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = label.trim();
    if (trimmed.length < 3) {
      setError('Give it a label first, e.g. "App Store review 2026-10".');
      return;
    }
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('mint_review_code', { p_label: trimmed, p_days: 30 });
    setBusy(false);
    if (rpcError) {
      setError(
        rpcError.code === '42501'
          ? 'Only Roxy core staff can create a store review code.'
          : 'Could not create the review code. Nothing was created — try again.',
      );
      return;
    }
    setCode(String(data));
    setLabel('');
    startTransition(() => router.refresh());
  };

  return (
    <section className="border rounded-lg p-5 space-y-3" aria-labelledby="review-code-heading">
      <h2 id="review-code-heading" className="text-lg font-semibold">
        Store review code
      </h2>
      <p className="text-sm text-muted-foreground max-w-prose">
        For the App Store or Play reviewer&apos;s seed account. Single use, expires in 30 days,
        joins Roxy Official. It does not approve anyone: approve the application in the review
        queue. Steps: docs/ops/store-review-account.md.
      </p>
      <form onSubmit={(event) => void mint(event)} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="review-label">Label</Label>
          <Input
            id="review-label"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="App Store review 2026-10"
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? 'Creating…' : 'Create store review code'}
        </Button>
      </form>
      {error && (
        <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {code && (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <code className="rounded-md bg-background border px-3 py-2 font-mono text-lg tracking-[0.35em]">
            {code}
          </code>
          <CopyButton value={code} ariaLabel={`Copy review code ${code}`} />
        </div>
      )}
    </section>
  );
}
