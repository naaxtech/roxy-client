// supabase/functions/request-invite-code/index.ts — RETIRED, 410 no-op.
//
// Origin: added in 9f98005 ("feat(roxy): invite gate, ...") as a public
// "request a code" endpoint, later dropped from the repo while a deployed copy
// stayed live (audit-studio-backend.md: live on prod, verify_jwt=false, source
// not in git). It contradicts the gate's rule in config.toml: codes are minted
// by community admins in Roxy Studio and handed to a person directly; there
// is deliberately no public request queue ("every member was invited", not
// "every member asked").
//
// Why it is a stub, not deleted: an older installed build may still call it.
// It now does no work, reads no body, stores nothing and logs nothing, and
// tells the caller plainly that codes come from a member or community admin.
// When it may go: once no supported build references it (check the oldest
// build still in testers' hands), with Nicole's agreement.
import { goneResponse } from '../_shared/retired.ts';

Deno.serve((req) =>
  goneResponse(
    req,
    'request-invite-code',
    'Invite codes come from a Roxy member or community admin. Ask someone who invited you.',
  )
);
