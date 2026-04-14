'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Attendee {
  user_id: string;
  ticket_code: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  rsvp_at: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
}

interface AttendeeListProps {
  attendees: Attendee[];
  eventId: string;
  canCheckin: boolean;
}

export function AttendeeList({ attendees, eventId, canCheckin }: AttendeeListProps) {
  const [list, setList] = useState<Attendee[]>(attendees);
  const [ticketInput, setTicketInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);

  const handleCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketInput.trim()) return;
    setCheckinError(null);
    setChecking(true);

    const res = await fetch(`/api/events/${eventId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_code: ticketInput.trim().toUpperCase() }),
    });
    const json = await res.json();
    setChecking(false);

    if (!res.ok) {
      setCheckinError(json.error ?? 'Check-in failed');
      return;
    }

    setList(prev =>
      prev.map(a =>
        a.ticket_code === ticketInput.trim().toUpperCase()
          ? { ...a, is_checked_in: true, checked_in_at: json.checked_in_at }
          : a,
      ),
    );
    setTicketInput('');
  };

  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">No attendees yet.</p>;
  }

  return (
    <div className="space-y-4">
      {canCheckin && (
        <form onSubmit={handleCheckin} className="flex gap-2">
          <Input
            placeholder="Scan or type ticket code"
            value={ticketInput}
            onChange={e => setTicketInput(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" disabled={checking || !ticketInput.trim()}>
            {checking ? 'Checking…' : 'Check In'}
          </Button>
        </form>
      )}
      {checkinError && <p className="text-sm text-destructive">{checkinError}</p>}

      <ul className="divide-y">
        {list.map(a => (
          <li key={a.user_id} className="py-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">
                {a.profiles?.display_name ?? 'Anonymous'}
              </p>
              <p className="text-xs text-muted-foreground font-mono">{a.ticket_code}</p>
            </div>
            <div className="flex items-center gap-2">
              {a.is_checked_in ? (
                <Badge variant="default" className="bg-green-600 hover:bg-green-600">
                  Checked In
                </Badge>
              ) : (
                <Badge variant="secondary">Going</Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
