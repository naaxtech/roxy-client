/**
 * Launch waves: one batch of single-use invite codes per wave label.
 *
 * Codes are minted by the same path as /invites — a plain insert into
 * invite_codes with `code` left to its column DEFAULT generate_invite_code()
 * (migration 070), so the entropy and uniqueness rules are the database's.
 * The wave is the `label`; staff_launch_funnel() (migration 131) groups by it,
 * which is what makes per-wave redemption → application → approval countable.
 */
import { endOfUtcDayIso } from '@/lib/dates';

export const WAVE_MAX_CODES = 200;
export const WAVE_LABEL_MAX = 80;
const MAX_DAYS_AHEAD = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WaveForm {
  count: string;
  label: string;
  expiry: string;
  communityId: string;
}

export type WaveInput =
  | { ok: true; count: number; label: string; expiresAt: string; communityId: string | null }
  | { ok: false; error: string };

export function validateWave(form: WaveForm, now: Date = new Date()): WaveInput {
  const countText = typeof form.count === 'string' ? form.count.trim() : '';
  const count = /^\d+$/.test(countText) ? Number(countText) : NaN;
  if (!Number.isInteger(count) || count < 1 || count > WAVE_MAX_CODES) {
    return { ok: false, error: `How many codes? A whole number from 1 to ${WAVE_MAX_CODES}.` };
  }

  const label = typeof form.label === 'string' ? form.label.trim() : '';
  if (label === '') return { ok: false, error: 'Give the wave a label, e.g. “Wave 1 — Pride”. The funnel counts by it.' };
  if (label.length > WAVE_LABEL_MAX) return { ok: false, error: `Keep the label under ${WAVE_LABEL_MAX} characters.` };

  const expiry = typeof form.expiry === 'string' ? form.expiry.trim() : '';
  const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? endOfUtcDayIso(expiry) : null;
  if (!expiresAt) return { ok: false, error: 'Pick when these codes stop working. A wave code always expires.' };
  const t = new Date(expiresAt).getTime();
  if (t <= now.getTime()) return { ok: false, error: 'The expiry has to be in the future.' };
  if (t > now.getTime() + MAX_DAYS_AHEAD * DAY_MS) {
    return { ok: false, error: 'Keep the expiry within a year. Issue a new wave later instead.' };
  }

  const cid = typeof form.communityId === 'string' ? form.communityId.trim() : '';
  if (cid !== '' && !UUID_RE.test(cid)) return { ok: false, error: 'Choose a community from the list.' };

  return { ok: true, count, label, expiresAt, communityId: cid === '' ? null : cid };
}

/**
 * One CSV cell. Quotes commas/quotes/newlines, and prefixes a quote mark on
 * anything a spreadsheet would run as a formula (= + - @), because this file
 * is opened in Sheets/Excel by whoever hands the codes out.
 */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export interface WaveCode {
  code: string;
  label: string;
  communityName: string;
  expiresAt: string | null;
}

export function codesToCsv(codes: WaveCode[]): string {
  const lines = ['code,wave,community,expires_utc'];
  for (const c of codes) {
    lines.push(
      [c.code, c.label, c.communityName, c.expiresAt ? c.expiresAt.slice(0, 10) : ''].map(csvCell).join(','),
    );
  }
  return lines.join('\r\n');
}
