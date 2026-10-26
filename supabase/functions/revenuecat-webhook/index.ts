// supabase/functions/revenuecat-webhook/index.ts
// RevenueCat → supporter_entitlements (migration 140). Wiring only: every rule
// is in _shared/revenuecat.ts (tested) and apply_supporter_event (proven in
// supabase/tests/140_supporter_entitlements_check.sql).
//
// Departures from the CLAUDE.md §7 order, on purpose:
//   * no handleCors — RevenueCat calls server to server; no browser ever does.
//   * no verifyJWT — RevenueCat cannot hold a Supabase JWT (verify_jwt = false
//     in config.toml). It is authenticated by the shared secret instead:
//     Authorization must equal REVENUECAT_WEBHOOK_SECRET (or Bearer <it>).
//   * no rate limit / DEV_MOCK — no AI call, and nothing runs before the secret.
//
// Env: REVENUECAT_WEBHOOK_SECRET (≥ 16 chars; unset ⇒ 503 for every caller),
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { getSupabaseClient } from '../_shared/auth.ts';
import { handleRevenueCatWebhook } from '../_shared/revenuecat.ts';

Deno.serve((req) =>
  handleRevenueCatWebhook(req, {
    secret: Deno.env.get('REVENUECAT_WEBHOOK_SECRET'),
    apply: async (args) => {
      const { data, error } = await getSupabaseClient().rpc('apply_supporter_event', args);
      return {
        data: typeof data === 'string' ? data : null,
        error: error ? { code: error.code, message: error.message } : null,
      };
    },
  })
);
