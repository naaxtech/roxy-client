// Tests for the email templates (_shared/emailTemplates.ts).
//
// Run from supabase/functions/:
//   deno test --no-check --allow-read _shared/emailTemplates.test.ts
//
// G-01: the database queued application_* emails that process-email-queue had
// no template for, so every one threw "Unknown email type" and was
// dead-lettered after five tries. Nobody was told she was in. These tests pin
// three things: every type the database can queue renders, nothing that could
// out a woman (her community's name, her own details) reaches a subject line or
// a staff alert, and the words she reads are the ones we mean.

import { renderTemplate, TEMPLATE_TYPES } from './emailTemplates.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}
function ok(cond: unknown, label: string) {
  if (!cond) throw new Error(label);
}
function lacks(haystack: string, needle: string, label: string) {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`${label}: found "${needle}" in\n  ${haystack}`);
  }
}

const COMMUNITY = 'Lesbians of Leeds';
const APP_URL = 'https://roxy.expo.app';

// What a careless enqueue could put in a payload. None of it may surface.
const LEAKY = {
  community_name: COMMUNITY,
  display_name: 'Sam Applicant',
  username: 'sam_a',
  email: 'sam@example.com',
};

// ── Every type the database can queue has a template ────────────────────────

// The latest CHECK on email_queue.email_type across all migrations is the list
// of types the database accepts. If a migration adds a type and nobody adds a
// template, this fails here instead of dead-lettering in production.
async function queuedTypesFromMigrations(): Promise<string[]> {
  const dir = new URL('../../migrations/', import.meta.url);
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && /^\d+_.*\.sql$/.test(entry.name)) files.push(entry.name);
  }
  files.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  let latest: string | null = null;
  for (const name of files) {
    const sql = (await Deno.readTextFile(new URL(name, dir))).replace(/\r/g, '');
    const re = /email_queue_email_type_check\s+CHECK\s*\(\s*email_type\s+IN\s*\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) latest = m[1];
  }
  if (!latest) throw new Error('no email_queue_email_type_check found in migrations');
  return [...latest.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

Deno.test('every email type the database accepts has a template (G-01)', async () => {
  const queued = await queuedTypesFromMigrations();
  ok(queued.includes('application_approved'), 'migration parse found application_approved');
  // Render, don't trust a list: a type is covered only if it actually renders.
  const missing = queued.filter((t) => {
    try {
      renderTemplate(t, {});
      return false;
    } catch {
      return true;
    }
  });
  eq(missing, [], 'types the DB can queue but no template renders');
  for (const t of queued) ok(TEMPLATE_TYPES.includes(t), `${t} listed in TEMPLATE_TYPES`);
  for (const t of queued) {
    const out = renderTemplate(t, {});
    ok(out.subject.length > 0 && out.html.length > 0, `${t} renders with an empty payload`);
    lacks(out.subject + out.html, 'undefined', `${t} with empty payload`);
    lacks(out.subject + out.html, 'Invalid Date', `${t} with empty payload`);
  }
});

Deno.test('an unknown type still throws, so the queue records why', () => {
  let threw = false;
  try {
    renderTemplate('not_a_type', {});
  } catch (e) {
    threw = e instanceof Error && e.message.includes('Unknown email type');
  }
  ok(threw, 'unknown type throws Unknown email type');
});

// ── Applicant emails ────────────────────────────────────────────────────────

const APPLICANT_TYPES = [
  'application_received',
  'application_approved',
  'application_rejected',
  'application_appeal_upheld',
];

Deno.test('applicant emails never name her community, anywhere', () => {
  for (const t of APPLICANT_TYPES) {
    const out = renderTemplate(t, { ...LEAKY, reason: 'not_known', can_reapply_at: '2026-11-10T09:00:00Z' });
    lacks(out.subject, COMMUNITY, `${t} subject`);
    lacks(out.html, COMMUNITY, `${t} body`);
    lacks(out.subject, 'Sam', `${t} subject names her`);
  }
});

Deno.test('subjects are short and say nothing about what kind of app this is', () => {
  for (const t of APPLICANT_TYPES) {
    const { subject } = renderTemplate(t, {});
    ok(subject.length <= 60, `${t} subject is short (${subject.length})`);
    for (const word of ['lesbian', 'queer', 'wlw', 'community', 'rejected', 'denied']) {
      lacks(subject, word, `${t} subject`);
    }
  }
});

Deno.test('received: tells her we have it and how long it usually takes', () => {
  const { subject, html } = renderTemplate('application_received', { application_id: 'a1' });
  eq(subject, 'We’ve got your Roxy application', 'received subject');
  ok(/48 hours/.test(html), 'received states the real review window');
  ok(html.includes(APP_URL), 'received links to the app');
});

Deno.test('approved: celebrates and links straight to the app', () => {
  const { subject, html } = renderTemplate('application_approved', { application_id: 'a1' });
  eq(subject, 'You’re in. Welcome to Roxy 💜', 'approved subject');
  ok(html.includes(`href="${APP_URL}"`), 'approved has a link to https://roxy.expo.app');
  ok(/open roxy/i.test(html), 'approved has a clear call to action');
});

Deno.test('rejected: kind, gives the reason category, the cooldown date and the appeal route', () => {
  const { subject, html } = renderTemplate('application_rejected', {
    reason: 'not_known',
    can_reapply_at: '2026-11-10T09:00:00Z',
  });
  eq(subject, 'An update on your Roxy application', 'rejected subject');
  ok(html.includes('10 November 2026'), 'rejected shows the date she can apply again');
  ok(/appeal/i.test(html), 'rejected explains she can appeal');
  ok(/new invite code/i.test(html), 'rejected says what she needs to reapply');
  ok(/couldn’t confirm they know you/.test(html), 'not_known reason rendered in plain words');
});

Deno.test('rejected: every reason category reads as a sentence, never as a code', () => {
  const keys = ['not_verified', 'not_known', 'incomplete', 'safety', 'other'];
  const bodies = new Set<string>();
  for (const reason of [...keys, null, 'something_new']) {
    const { html } = renderTemplate('application_rejected', { reason, can_reapply_at: '2026-11-10T09:00:00Z' });
    // Single-word keys (safety, other) are ordinary English; only the
    // snake_case keys would be a leak of the raw code.
    for (const k of ['not_verified', 'not_known', 'something_new', 'null']) {
      lacks(html, k, `reason ${reason} leaks a key`);
    }
    bodies.add(html);
  }
  // not_verified, not_known, incomplete and safety each say something different;
  // other, null and an unknown key all fall back to the same no-reason body.
  eq(bodies.size, 5, 'distinct bodies per reason');
});

Deno.test('rejected without a cooldown date still renders a usable email', () => {
  const { html } = renderTemplate('application_rejected', { reason: 'other', can_reapply_at: null });
  lacks(html, 'Invalid Date', 'no cooldown date');
  lacks(html, 'null', 'no cooldown date');
  ok(/appeal/i.test(html), 'appeal still offered');
});

Deno.test('appeal upheld: final, kind, and gives the date she can try again', () => {
  const { subject, html } = renderTemplate('application_appeal_upheld', {
    can_reapply_at: '2026-11-10T09:00:00Z',
  });
  eq(subject, 'Your appeal: an update from Roxy', 'upheld subject');
  ok(html.includes('10 November 2026'), 'upheld shows the date');
});

Deno.test('Roxy is a wingwoman in her own emails, never an assistant or a bot', () => {
  for (const t of APPLICANT_TYPES) {
    const { html } = renderTemplate(t, {});
    ok(!/\b(assistant|chatbot|bot)\b/i.test(html), `${t} body calls Roxy an assistant/bot`);
    ok(!/\bAI\b/.test(html), `${t} body calls Roxy AI`);
  }
});

// ── Staff alerts ────────────────────────────────────────────────────────────

Deno.test('staff alert: counts only, nothing about any applicant in subject or body', () => {
  const { subject, html } = renderTemplate('staff_application_alert', {
    ...LEAKY,
    waiting: 3,
    oldest_hours: 50,
    open_appeals: 1,
  });
  eq(subject, '3 Roxy applications waiting for review', 'staff subject');
  for (const leak of [COMMUNITY, 'Sam', 'sam_a', 'sam@example.com']) {
    lacks(subject, leak, 'staff subject');
    lacks(html, leak, 'staff body');
  }
  ok(/2 days/.test(html), 'oldest wait shown in days once over 48 hours');
  ok(/overdue/i.test(html), 'over 48 hours is called overdue');
  ok(/1 open appeal\b/.test(html), 'open appeals count');
  ok(html.includes('/applications'), 'links to the Studio queue');
});

Deno.test('staff alert: singular and under-a-day wording', () => {
  const { subject, html } = renderTemplate('staff_application_alert', { waiting: 1, oldest_hours: 3 });
  eq(subject, '1 Roxy application waiting for review', 'singular subject');
  ok(/3 hours/.test(html), 'hours under a day');
  lacks(html, 'overdue', 'fresh queue is not overdue');
});

Deno.test('staff_new_application is the same alert under the name the brief used', () => {
  const a = renderTemplate('staff_new_application', { waiting: 2, oldest_hours: 1 });
  const b = renderTemplate('staff_application_alert', { waiting: 2, oldest_hours: 1 });
  eq(a, b, 'alias renders identically');
});

Deno.test('staff appeal alert: count only, links to the appeals page', () => {
  const { subject, html } = renderTemplate('staff_appeal_alert', { ...LEAKY, open_appeals: 2, waiting: 0 });
  eq(subject, '2 Roxy appeals waiting for a decision', 'appeal subject');
  lacks(subject + html, COMMUNITY, 'appeal alert');
  ok(html.includes('/staff/appeals'), 'links to Studio appeals');
});

// ── Existing marketplace templates keep working, now escaped ────────────────

Deno.test('marketplace templates still render and escape what sellers typed', () => {
  const { subject, html } = renderTemplate('product_approved', { product_name: '<img src=x onerror=alert(1)>' });
  // A subject is plain text (no markup is interpreted), so it carries the name
  // as typed; the body is HTML, so it must not.
  ok(subject.includes('<img src=x'), 'subject keeps the plain-text name');
  lacks(html, '<img', 'body escaped');
  ok(html.includes('&lt;img'), 'body shows the name escaped');
  const refund = renderTemplate('refund_notification_buyer', { order_short_id: 'AB12', amount_cents: 1250 });
  ok(refund.html.includes('$12.50'), 'refund amount');
});
