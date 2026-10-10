// supabase/functions/_shared/emailTemplates.ts
//
// Every email process-email-queue can send, as pure functions of the queued
// payload. No I/O, so every word is unit-tested (emailTemplates.test.ts).
//
// G-01: the database queued application_* emails for months that this function
// had no template for. Each threw "Unknown email type", was retried five times
// and dead-lettered, and the woman waiting on a decision heard nothing. The
// test file now reads the latest email_queue CHECK from the migrations and
// fails if any type the database accepts has no template here.
//
// Privacy rules (an inbox preview is a lock screen too):
//   * Applicant subjects and bodies never name her community, even if a
//     payload carries it. Which community vouched for her can out her.
//   * Subjects never say what kind of app Roxy is, and never say "rejected".
//   * Staff alerts carry counts only — no applicant names, no communities.
//   * Every payload value that reaches HTML is escaped.
//
// Roxy is a wingwoman, never an assistant or a bot.

export const APP_URL = 'https://roxy.expo.app';
export const DEFAULT_STUDIO_URL = 'https://roxycommunity.netlify.app';

export interface RenderedEmail {
  subject: string;
  html: string;
}

export interface RenderOptions {
  /** Studio base URL for staff and seller links (env STUDIO_URL). */
  studioUrl?: string;
}

type Payload = Record<string, unknown>;

// Colours from apps/mobile/lib/theme.ts (light theme): background, surface,
// textPrimary, textSecondary, primary, line. An email client cannot read the
// app's tokens, so the light values are copied here; keep them in step.
const C = {
  background: '#F7F5EE',
  surface: '#FBF9F3',
  textPrimary: '#241234',
  textSecondary: '#5D4980',
  primary: '#D81368',
  onPrimary: '#FFFFFF',
  line: '#E3DFD4',
} as const;

// Must match membership_applications_decision_reason_check (130). An unknown
// key falls back to the no-reason wording, never to the raw key.
const REJECTION_REASONS: Record<string, string> = {
  not_verified: 'We weren’t able to verify the details you gave us.',
  not_known: 'The people who sent your invite couldn’t confirm they know you.',
  incomplete: 'Your application didn’t give our reviewers quite enough to go on.',
  safety: 'Our reviewers had a safety concern they couldn’t resolve from your application.',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length > 0 ? s : fallback;
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "10 November 2026", or null when the payload has no usable date. */
export function formatDay(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** "under an hour" · "3 hours" · "2 days" (whole days once it is a day or more). */
export function formatWait(hours: unknown): string {
  const h = count(hours);
  if (h < 1) return 'under an hour';
  if (h < 24) return plural(h, 'hour');
  return plural(Math.floor(h / 24), 'day');
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0 8px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${C.primary};color:${C.onPrimary};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">${escapeHtml(label)}</a></p>`;
}

function p(inner: string): string {
  return `<p style="margin:0 0 14px;line-height:1.55">${inner}</p>`;
}

/**
 * The shared frame. `preheader` is the inbox preview line; like the subject it
 * must never carry a community name.
 */
function layout(preheader: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:${C.background}">` +
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>` +
    `<div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.textPrimary};font-size:16px">` +
    `<div style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:28px 24px">${body}</div>` +
    `<p style="margin:18px 4px 0;font-size:12px;line-height:1.5;color:${C.textSecondary}">You’re getting this because you applied to join Roxy. We’ll only email you about your application.</p>` +
    `</div></body></html>`;
}

function staffLayout(body: string): string {
  return `<!doctype html><html><body style="margin:0;background:${C.background}">` +
    `<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.textPrimary};font-size:15px">${body}` +
    `<p style="margin:18px 0 0;font-size:12px;color:${C.textSecondary}">Counts only, on purpose: an inbox preview is a lock screen too. Details are in Studio.</p>` +
    `</div></body></html>`;
}

// ── Applicant ────────────────────────────────────────────────────────────────

function applicationReceived(): RenderedEmail {
  return {
    subject: 'We’ve got your Roxy application',
    html: layout(
      'Thanks for sending it. Here’s what happens next.',
      p('Hi,') +
        p('Thank you for sending your application. It’s with our reviewers now, and a real person reads every one.') +
        p('Most decisions land within <strong>48 hours</strong>. We’ll email you either way, and the app will update the moment it’s decided.') +
        p('While you wait, the Archive is open to you in the app.') +
        button(APP_URL, 'Open Roxy') +
        p('With love,<br>Roxy'),
    ),
  };
}

function applicationApproved(): RenderedEmail {
  return {
    subject: 'You’re in. Welcome to Roxy 💜',
    html: layout(
      'Your application is approved. Come on in.',
      `<p style="margin:0 0 14px;font-size:22px;font-weight:700;line-height:1.3">You’re in 💜</p>` +
        p('Your application has been approved, and everything in Roxy is open to you now.') +
        p('Say hi in your community’s chat, find a few people to follow and share your first post. We’re so glad you’re here.') +
        button(APP_URL, 'Open Roxy') +
        p('Already have the app open? Pull down to refresh, or close and reopen it.') +
        p('With love,<br>Roxy'),
    ),
  };
}

function reapplyLine(canReapplyAt: unknown): string {
  const day = formatDay(canReapplyAt);
  return day
    ? `You’re welcome to apply again with a new invite code from <strong>${escapeHtml(day)}</strong>.`
    : 'You’re welcome to apply again later with a new invite code.';
}

function applicationRejected(payload: Payload): RenderedEmail {
  const reason = typeof payload.reason === 'string' ? REJECTION_REASONS[payload.reason] : undefined;
  return {
    subject: 'An update on your Roxy application',
    html: layout(
      'An update on your application.',
      p('Hi,') +
        p('Thank you for applying to Roxy, and for your patience while we read it. We’re sorry to say we can’t approve your application this time.') +
        (reason ? p(escapeHtml(reason)) : '') +
        p(reapplyLine(payload.can_reapply_at)) +
        p('If you think we got this wrong, you can appeal once: open Roxy and you’ll find it on your application screen. Someone from the Roxy team will read it and let you know.') +
        button(APP_URL, 'Open Roxy') +
        p('Take care,<br>Roxy'),
    ),
  };
}

function appealUpheld(payload: Payload): RenderedEmail {
  return {
    subject: 'Your appeal: an update from Roxy',
    html: layout(
      'An update on your appeal.',
      p('Hi,') +
        p('Thank you for appealing. Someone from the Roxy team read your application and your appeal again carefully, and the decision stands.') +
        p(reapplyLine(payload.can_reapply_at)) +
        p('We know this isn’t the answer you hoped for, and we’re sorry.') +
        p('Take care,<br>Roxy'),
    ),
  };
}

// ── Staff ────────────────────────────────────────────────────────────────────

function staffApplicationAlert(payload: Payload, studio: string): RenderedEmail {
  const waiting = count(payload.waiting);
  const appeals = count(payload.open_appeals);
  const oldestHours = count(payload.oldest_hours);
  const overdue = waiting > 0 && oldestHours >= 48;
  return {
    subject: `${plural(waiting, 'Roxy application')} waiting for review`,
    html: staffLayout(
      p(`<strong>${plural(waiting, 'application')}</strong> ${waiting === 1 ? 'is' : 'are'} waiting for review.`) +
        (waiting > 0
          ? p(`The oldest has waited ${escapeHtml(formatWait(oldestHours))}${overdue ? ' — <strong>overdue</strong> (we promise 48 hours)' : ''}.`)
          : '') +
        (appeals > 0 ? p(`${plural(appeals, 'open appeal')} too.`) : '') +
        button(`${studio}/applications`, 'Open the queue'),
    ),
  };
}

function staffAppealAlert(payload: Payload, studio: string): RenderedEmail {
  const appeals = count(payload.open_appeals);
  const waiting = count(payload.waiting);
  return {
    subject: `${plural(appeals, 'Roxy appeal')} waiting for a decision`,
    html: staffLayout(
      p(`<strong>${plural(appeals, 'appeal')}</strong> ${appeals === 1 ? 'is' : 'are'} waiting for a decision.`) +
        (waiting > 0 ? p(`${plural(waiting, 'application')} also in the queue.`) : '') +
        button(`${studio}/staff/appeals`, 'Open appeals'),
    ),
  };
}

// ── Marketplace (unchanged wording; values now escaped) ──────────────────────

function marketplace(emailType: string, payload: Payload, studio: string): RenderedEmail | null {
  const e = (v: unknown, fallback = '') => escapeHtml(text(v, fallback));
  switch (emailType) {
    case 'order_shipped_buyer':
      return {
        subject: `Your order #${text(payload.order_short_id)} has shipped!`,
        html: `<h2>Your order has shipped</h2>
               <p>Tracking: <a href="${e(payload.carrier_url)}">${e(payload.tracking_number)}</a></p>
               <p>${e(payload.items_summary)}</p>`,
      };
    case 'product_approved':
      return {
        subject: `Your product "${text(payload.product_name, 'listing')}" has been approved`,
        html: `<h2>Product Approved!</h2>
               <p>"${e(payload.product_name, 'Your listing')}" is now live on Roxy.</p>`,
      };
    case 'product_rejected':
      return {
        subject: `Update on your product "${text(payload.product_name, 'listing')}"`,
        html: `<h2>Product Not Approved</h2>
               <p>Reason: ${e(payload.rejection_reason, 'Not given')}</p>
               <p>You can edit and resubmit from Roxy Studio.</p>`,
      };
    case 'refund_notification_buyer': {
      const cents = Number(payload.amount_cents);
      const amount = Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)}` : 'Your payment';
      return {
        subject: `Refund processed for order #${text(payload.order_short_id)}`,
        html: `<h2>Refund Processed</h2>
               <p>${amount} has been refunded for order #${e(payload.order_short_id)}.</p>`,
      };
    }
    case 'dispute_alert_business':
      return {
        subject: `Action required: Dispute on order #${text(payload.order_short_id)}`,
        html: `<h2>Dispute Alert</h2>
               <p>A dispute has been opened for order #${e(payload.order_short_id)}.</p>
               <p>Response due: ${e(payload.response_due_by, 'see Studio')}</p>
               <p><a href="${escapeHtml(studio)}/orders">View in Studio</a></p>`,
      };
    case 'business_approved':
      return {
        subject: `Congratulations! Your Roxy business profile is active`,
        html: `<h2>Welcome to Roxy Marketplace, ${e(payload.display_name, 'there')}! 🎉</h2>
               <p>Your business <strong>${e(payload.business_name, 'profile')}</strong> has been approved and your Roxy business profile is now active.</p>
               <p>You can now log into <a href="${escapeHtml(studio)}">Roxy Studio</a> to:</p>
               <ul>
                 <li>Add and manage your products</li>
                 <li>Connect Stripe to receive payments</li>
                 <li>Track orders and payouts</li>
               </ul>
               <p>Welcome to the community! 💜</p>`,
      };
    case 'business_rejected':
      return {
        subject: `Update on your Roxy business application`,
        html: `<h2>Hi ${e(payload.display_name, 'there')},</h2>
               <p>Thank you for applying to sell on Roxy. Unfortunately, we're unable to approve <strong>${e(payload.business_name, 'your business')}</strong> at this time.</p>
               <p><strong>Reason:</strong> ${e(payload.rejection_reason, 'Not given')}</p>
               <p>If you believe this is an error or would like to reapply, please reach out to our team.</p>`,
      };
    default:
      return null;
  }
}

/** Every type renderTemplate knows. Must cover the email_queue CHECK (tested). */
export const TEMPLATE_TYPES: readonly string[] = [
  'order_shipped_buyer',
  'product_approved',
  'product_rejected',
  'refund_notification_buyer',
  'dispute_alert_business',
  'business_approved',
  'business_rejected',
  'application_received',
  'application_approved',
  'application_rejected',
  'application_appeal_upheld',
  'staff_application_alert',
  // The name the launch brief used for the same alert; not queued by 130 today.
  'staff_new_application',
  'staff_appeal_alert',
];

export function renderTemplate(
  emailType: string,
  payload: Payload | null | undefined,
  options: RenderOptions = {},
): RenderedEmail {
  const data: Payload = payload ?? {};
  const studio = (options.studioUrl || DEFAULT_STUDIO_URL).replace(/\/+$/, '');
  switch (emailType) {
    case 'application_received':
      return applicationReceived();
    case 'application_approved':
      return applicationApproved();
    case 'application_rejected':
      return applicationRejected(data);
    case 'application_appeal_upheld':
      return appealUpheld(data);
    case 'staff_application_alert':
    case 'staff_new_application':
      return staffApplicationAlert(data, studio);
    case 'staff_appeal_alert':
      return staffAppealAlert(data, studio);
  }
  const rendered = marketplace(emailType, data, studio);
  if (rendered) return rendered;
  throw new Error(`Unknown email type: ${emailType}`);
}
