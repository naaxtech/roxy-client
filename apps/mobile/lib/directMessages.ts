import { Analytics } from './analytics';
import { startDirect } from './chat';

/**
 * Find or open the 1:1 conversation with `partnerId`. Returns its id.
 *
 * One server call (`start_direct`, migration 132). The old version selected
 * then inserted into `conversations` from the phone, which decided nothing
 * about requests: a stranger's thread landed in her main inbox (CHAT-02).
 * The RPC files it under the other woman's Requests, applies the daily cap,
 * and refuses a block-paired pair as "not available" without saying why.
 *
 * `userId` is kept for call-site compatibility; the server uses auth.uid().
 */
export async function openDirectChat(_userId: string, partnerId: string): Promise<string> {
  const id = await startDirect(partnerId);
  if (!id) throw new Error('Could not open that chat. Please try again.');
  Analytics.dmOpened(id);
  return id;
}
