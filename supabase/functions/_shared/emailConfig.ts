// Where email links and sender addresses come from (Nicole, 2026-10-11).
//
// Studio lives at https://studio.roxyhq.com; email goes out from the
// roxyhq.com domain and replies reach hello@roxyhq.com. These are defaults:
// STUDIO_URL, EMAIL_FROM and EMAIL_REPLY_TO (edge function secrets) override.
// Pure (the env reader is passed in) so it is unit-tested without Deno.env.

export const DEFAULT_STUDIO_URL = 'https://studio.roxyhq.com';
export const DEFAULT_EMAIL_FROM = 'Roxy <noreply@roxyhq.com>';
export const DEFAULT_EMAIL_REPLY_TO = 'hello@roxyhq.com';

export type EnvReader = (key: string) => string | undefined;

const pick = (value: string | undefined, fallback: string): string => {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : fallback;
};

/** Studio base URL without a trailing slash. */
export function resolveStudioUrl(getEnv: EnvReader): string {
  return pick(getEnv('STUDIO_URL'), DEFAULT_STUDIO_URL).replace(/\/+$/, '');
}

export interface EmailSender {
  from: string;
  replyTo: string;
}

export function resolveEmailSender(getEnv: EnvReader): EmailSender {
  return {
    from: pick(getEnv('EMAIL_FROM'), DEFAULT_EMAIL_FROM),
    replyTo: pick(getEnv('EMAIL_REPLY_TO'), DEFAULT_EMAIL_REPLY_TO),
  };
}

/** Deno.env reader that never throws (no --allow-env in some test runs). */
export const denoEnv: EnvReader = (key) => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};
