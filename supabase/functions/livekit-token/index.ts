// supabase/functions/livekit-token/index.ts — RETIRED, 410 no-op.
//
// Origin: b98a06a ("feat: Rooms tab, My Chats, community rooms, video
// provider abstraction") added a LiveKit token signer beside Daily.co. The
// source was deleted on 2026-08-02 (CHANGELOG "The phantom second video
// provider"; no @livekit/* package was ever installed, nothing called it),
// but the deployed function stayed live on prod (audit-studio-backend.md).
//
// Why it is a stub, not deleted: house rule — an endpoint an older build may
// still call becomes a commented no-op. It signs nothing, reads no body and
// holds no LiveKit secret. Daily.co is the only video provider
// (apps/mobile/lib/video/index.ts). When it may go: with Nicole's agreement,
// once the deployed copy has been replaced by this stub.
import { goneResponse } from '../_shared/retired.ts';

Deno.serve((req) =>
  goneResponse(req, 'livekit-token', 'Video rooms use Daily. Update Roxy to join a room.')
);
