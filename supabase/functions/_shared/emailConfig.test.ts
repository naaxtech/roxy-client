// Tests for _shared/emailConfig.ts — where links and sender addresses come from.
//
// Run from supabase/functions/:
//   deno test --no-check --allow-env _shared/emailConfig.test.ts
//
// Nicole (2026-10-11): Studio lives at https://studio.roxyhq.com and email
// goes out as Roxy <noreply@roxyhq.com>, replies to hello@roxyhq.com. Both are
// defaults; STUDIO_URL / EMAIL_FROM / EMAIL_REPLY_TO still override.

// No remote imports (same as the other _shared tests): CI runs offline-safe.
function assertEquals(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}
  expected ${e}
  received ${a}`);
}
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_REPLY_TO,
  DEFAULT_STUDIO_URL,
  resolveEmailSender,
  resolveStudioUrl,
} from './emailConfig.ts';
import { DEFAULT_STUDIO_URL as TEMPLATE_STUDIO_URL } from './emailTemplates.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

Deno.test('defaults are the roxyhq.com addresses', () => {
  assertEquals(DEFAULT_STUDIO_URL, 'https://studio.roxyhq.com');
  assertEquals(DEFAULT_EMAIL_FROM, 'Roxy <noreply@roxyhq.com>');
  assertEquals(DEFAULT_EMAIL_REPLY_TO, 'hello@roxyhq.com');
  assertEquals(TEMPLATE_STUDIO_URL, DEFAULT_STUDIO_URL, 'templates link to the same Studio');
});

Deno.test('studio url: default when unset or blank, env wins, no trailing slash', () => {
  assertEquals(resolveStudioUrl(env({})), 'https://studio.roxyhq.com');
  assertEquals(resolveStudioUrl(env({ STUDIO_URL: '   ' })), 'https://studio.roxyhq.com');
  assertEquals(resolveStudioUrl(env({ STUDIO_URL: 'https://staging-studio.roxyhq.com/' })), 'https://staging-studio.roxyhq.com');
});

Deno.test('sender: default from/reply-to, env overrides each', () => {
  assertEquals(resolveEmailSender(env({})), { from: 'Roxy <noreply@roxyhq.com>', replyTo: 'hello@roxyhq.com' });
  assertEquals(
    resolveEmailSender(env({ EMAIL_FROM: 'Roxy Test <test@roxyhq.com>', EMAIL_REPLY_TO: 'help@roxyhq.com' })),
    { from: 'Roxy Test <test@roxyhq.com>', replyTo: 'help@roxyhq.com' },
  );
  assertEquals(resolveEmailSender(env({ EMAIL_FROM: '' })).from, 'Roxy <noreply@roxyhq.com>');
});

Deno.test('no getroxy.app sender survives anywhere in the edge functions', async () => {
  const hits: string[] = [];
  const root = new URL('../', import.meta.url);
  async function walk(dir: URL) {
    for await (const e of Deno.readDir(dir)) {
      const u = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
      if (e.isDirectory) { await walk(u); continue; }
      if (!/\.ts$/.test(e.name) || e.name === 'emailConfig.test.ts') continue;
      const src = await Deno.readTextFile(u);
      if (src.includes('getroxy.app') || src.includes('roxycommunity.netlify.app') || src.includes('roxy-studio.vercel.app')) {
        hits.push(u.pathname);
      }
    }
  }
  await walk(root);
  assertEquals(hits, []);
});
