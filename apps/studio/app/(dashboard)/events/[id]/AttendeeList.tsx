'use client';

import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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

// Perform a check-in via the existing API route
async function doCheckin(eventId: string, ticketCode: string): Promise<{ ok: boolean; checked_in_at?: string; error?: string }> {
  const res = await fetch(`/api/events/${eventId}/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_code: ticketCode.trim().toUpperCase() }),
  });
  const json = await res.json();
  return res.ok ? { ok: true, checked_in_at: json.checked_in_at } : { ok: false, error: json.error ?? 'Check-in failed' };
}

// ─── QR Modal ────────────────────────────────────────────────────────────────
function QRModal({ attendee, onClose }: { attendee: Attendee; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const name = attendee.profiles?.display_name ?? 'Attendee';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-2xl p-8 flex flex-col items-center gap-5 max-w-xs w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center">
          <p className="font-semibold text-foreground text-lg">{name}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{attendee.ticket_code}</p>
        </div>

        <div className="rounded-xl overflow-hidden border-4 border-white shadow-inner">
          <QRCodeSVG
            value={attendee.ticket_code}
            size={200}
            level="H"
            includeMargin
          />
        </div>

        {attendee.is_checked_in ? (
          <div className="flex items-center gap-2 rounded-full bg-green-500/15 px-4 py-2">
            <span className="text-green-500 text-lg">✓</span>
            <span className="text-green-600 font-semibold text-sm">Claimed</span>
          </div>
        ) : (
          <Badge variant="secondary" className="px-4 py-1">Not yet claimed</Badge>
        )}

        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── AttendeeRow ─────────────────────────────────────────────────────────────
function AttendeeRow({
  attendee,
  eventId,
  canCheckin,
  onCheckin,
  onShowQR,
}: {
  attendee: Attendee;
  eventId: string;
  canCheckin: boolean;
  onCheckin: (code: string, at: string) => void;
  onShowQR: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualCheckin = async () => {
    setLoading(true);
    setError(null);
    const result = await doCheckin(eventId, attendee.ticket_code);
    setLoading(false);
    if (result.ok && result.checked_in_at) {
      onCheckin(attendee.ticket_code, result.checked_in_at);
    } else {
      setError(result.error ?? 'Failed');
    }
  };

  const checkedInTime = attendee.checked_in_at
    ? new Date(attendee.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <li className="py-3 flex items-center gap-4">
      {/* QR thumbnail — click to enlarge */}
      <button
        onClick={onShowQR}
        className="shrink-0 rounded-lg overflow-hidden border border-border hover:border-primary transition-colors hover:shadow-md"
        title="View QR code"
        aria-label={`Show QR code for ${attendee.profiles?.display_name ?? 'attendee'}`}
      >
        <QRCodeSVG value={attendee.ticket_code} size={48} level="M" includeMargin={false} />
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {attendee.profiles?.display_name ?? 'Anonymous'}
        </p>
        <p className="text-xs text-muted-foreground font-mono">{attendee.ticket_code}</p>
        {checkedInTime && (
          <p className="text-xs text-green-600 mt-0.5">Claimed at {checkedInTime}</p>
        )}
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>

      {/* Status + action */}
      <div className="flex items-center gap-2 shrink-0">
        {attendee.is_checked_in ? (
          <Badge className="bg-green-600 hover:bg-green-600 text-white gap-1">
            <span>✓</span> Claimed
          </Badge>
        ) : (
          <>
            <Badge variant="secondary">Going</Badge>
            {canCheckin && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleManualCheckin}
                disabled={loading}
                className="text-xs h-7"
              >
                {loading ? '…' : 'Check In'}
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

// ─── AttendeeList ─────────────────────────────────────────────────────────────
export function AttendeeList({ attendees, eventId, canCheckin }: AttendeeListProps) {
  const [list, setList] = useState<Attendee[]>(attendees);
  const [ticketInput, setTicketInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [qrAttendee, setQrAttendee] = useState<Attendee | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const markCheckedIn = (code: string, at: string) => {
    setList(prev =>
      prev.map(a => a.ticket_code === code ? { ...a, is_checked_in: true, checked_in_at: at } : a)
    );
  };

  // Manual scan/type submit
  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = ticketInput.trim().toUpperCase();
    if (!code) return;
    setScanError(null);
    setScanSuccess(null);
    setScanning(true);
    const result = await doCheckin(eventId, code);
    setScanning(false);
    if (result.ok && result.checked_in_at) {
      const attendee = list.find(a => a.ticket_code === code);
      const name = attendee?.profiles?.display_name ?? code;
      setScanSuccess(`✓ ${name} checked in!`);
      markCheckedIn(code, result.checked_in_at);
      setTicketInput('');
      setTimeout(() => setScanSuccess(null), 4000);
      inputRef.current?.focus();
    } else {
      setScanError(result.error ?? 'Check-in failed');
    }
  };

  const checkedIn = list.filter(a => a.is_checked_in).length;
  const total = list.length;

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No attendees yet.</p>;
  }

  return (
    <div className="space-y-5">
      {/* Scan bar */}
      {canCheckin && (
        <div className="space-y-2">
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Scan QR or type ticket code…"
              value={ticketInput}
              onChange={e => setTicketInput(e.target.value)}
              className="font-mono"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={scanning || !ticketInput.trim()}>
              {scanning ? 'Checking…' : 'Check In'}
            </Button>
          </form>
          {scanSuccess && (
            <p className="text-sm font-medium text-green-600 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              {scanSuccess}
            </p>
          )}
          {scanError && (
            <p className="text-sm text-destructive">{scanError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Tip: use a QR scanner app or barcode scanner pointed at attendee&apos;s ticket, or type the code manually.
          </p>
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">{checkedIn} / {total} claimed</span>
          <span className="text-muted-foreground">{Math.round((checkedIn / total) * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${(checkedIn / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Attendee rows */}
      <ul className="divide-y">
        {list.map(a => (
          <AttendeeRow
            key={a.user_id}
            attendee={a}
            eventId={eventId}
            canCheckin={canCheckin}
            onCheckin={markCheckedIn}
            onShowQR={() => setQrAttendee(a)}
          />
        ))}
      </ul>

      {/* QR zoom modal */}
      {qrAttendee && (
        <QRModal attendee={qrAttendee} onClose={() => setQrAttendee(null)} />
      )}
    </div>
  );
}
