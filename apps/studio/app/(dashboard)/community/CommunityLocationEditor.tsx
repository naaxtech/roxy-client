'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  MEETS_OPTIONS,
  NEEDS_CITY_MESSAGE,
  describeLocation,
  isMeets,
  locationSaveErrorMessage,
  missingCityFor,
  type CityOption,
  type CommunityLocation,
  type Meets,
} from '@/lib/communityLocation';
import { CityCombobox } from './CityCombobox';

interface CommunityLocationEditorProps {
  communityId: string;
  communityName: string;
  initial: CommunityLocation;
}

type Pending = 'save' | 'remove' | null;

/**
 * "Edit location" for one community: city + meets, saved only through
 * set_community_location (the columns have no direct write grant). The page
 * shows this to the people who run the community; the RPC decides anyway, and
 * its refusal comes back as a sentence, never the database text.
 */
export function CommunityLocationEditor({ communityId, communityName, initial }: CommunityLocationEditorProps) {
  const router = useRouter();
  const baseId = useId();
  const formId = `${baseId}-location`;
  const [saved, setSaved] = useState<CommunityLocation>(initial);
  const [editing, setEditing] = useState(false);
  const [city, setCity] = useState<CityOption | null>(initial.city);
  const [meets, setMeets] = useState<Meets>(initial.meets);
  // Remounts the city field when the form opens, so it starts from what is saved.
  const [cityFieldKey, setCityFieldKey] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasLocation = saved.city !== null || saved.meets !== 'online';

  const openEditor = () => {
    setCity(saved.city);
    setMeets(saved.meets);
    setCityFieldKey((key) => key + 1);
    setError(null);
    setNotice(null);
    setEditing(true);
  };

  const closeEditor = () => {
    setEditing(false);
    setError(null);
  };

  const write = async (next: CommunityLocation, kind: Exclude<Pending, null>) => {
    setError(null);
    setNotice(null);
    if (missingCityFor(next.city, next.meets)) {
      setError(NEEDS_CITY_MESSAGE);
      return;
    }

    setPending(kind);
    let failure: string | null = null;
    let storedMeets: Meets = next.meets;
    try {
      const { data, error: rpcError } = await createClient().rpc('set_community_location', {
        p_community_id: communityId,
        p_city_id: next.city?.id ?? null,
        p_meets: next.meets,
      });
      if (rpcError) {
        failure = locationSaveErrorMessage(rpcError);
      } else {
        // The function returns the stored row; believe it over what was sent.
        const returned = (data as { meets?: unknown } | null)?.meets;
        if (isMeets(returned)) storedMeets = returned;
      }
    } catch {
      failure = locationSaveErrorMessage(null);
    }
    setPending(null);

    if (failure) {
      setError(failure);
      return;
    }
    setSaved({ city: next.city, meets: storedMeets });
    setEditing(false);
    setNotice(kind === 'remove' ? 'Location removed.' : 'Location saved.');
    router.refresh();
  };

  const busy = pending !== null;

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Where it meets: </span>
          <span>{describeLocation(saved)}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={editing}
          aria-controls={formId}
          onClick={editing ? closeEditor : openEditor}
        >
          Edit location
        </Button>
      </div>

      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {editing ? (
        <form
          id={formId}
          aria-label={`Where ${communityName} meets`}
          className="space-y-4 rounded-md border bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void write({ city, meets }, 'save');
          }}
        >
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <CityCombobox
            key={cityFieldKey}
            id={`${baseId}-city`}
            label="City"
            value={city}
            onChange={setCity}
            disabled={busy}
          />

          <div className="space-y-1.5">
            <Label htmlFor={`${baseId}-meets`}>Meets</Label>
            <Select
              id={`${baseId}-meets`}
              value={meets}
              disabled={busy}
              onChange={(event) => {
                if (isMeets(event.target.value)) setMeets(event.target.value);
              }}
            >
              {MEETS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {pending === 'save' ? 'Saving…' : 'Save location'}
            </Button>
            {hasLocation ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void write({ city: null, meets: 'online' }, 'remove')}
              >
                {pending === 'remove' ? 'Removing…' : 'Remove location'}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={closeEditor}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
