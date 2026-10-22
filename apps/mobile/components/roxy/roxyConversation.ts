import { create } from 'zustand';
import { callEdgeFunction } from '../../lib/supabase';
import { useRoxyChatStore } from '../../store/roxyChatStore';

/**
 * Roxy AI's conversation: one engine shared by the "Hello, Roxy" sheet and the
 * full chat (`app/roxy-chat.tsx`), so a chip tapped in the sheet is the same
 * conversation the full chat shows a moment later.
 *
 * Messages live in `store/roxyChatStore` (in memory; `resetAllStores` wipes it
 * on sign-out, so the next account on this phone never sees her chat). The
 * `roxy-chat` edge function keeps no history: closing the app ends the chat,
 * and the copy says so instead of promising a saved chat.
 *
 * A failed send keeps her message on screen and offers Retry with one
 * sentence (design direction v2 › Optimistic state). The failure is keyed to
 * the member who sent it, so a Retry can never send one member's words from
 * another member's account.
 */

export type RoxyFailure = { userId: string; text: string; message: string };

interface FailureState {
  failure: RoxyFailure | null;
}

/** The last failed send, if any. Module store, not under `store/`: it holds no profile data. */
export const useRoxyFailure = create<FailureState>(() => ({ failure: null }));

/** The failed send for THIS member, or null. */
export function failureFor(userId: string | null | undefined): RoxyFailure | null {
  const failure = useRoxyFailure.getState().failure;
  return failure && userId && failure.userId === userId ? failure : null;
}

/** Her daily cap was reached (edge function `roxy-chat`, 20 a day, HTTP 429). */
export const LIMIT_COPY = "That's all Roxy AI can chat today. Come back tomorrow.";
/** Anything else that went wrong. */
export const FAILED_COPY = "Roxy AI couldn't answer just now. Your message is still here.";

/** The thread id the edge function expects (not a row anywhere). */
export function conversationIdFor(userId: string): string {
  return `roxy-${userId}`;
}

async function deliver(userId: string, text: string): Promise<boolean> {
  const chat = useRoxyChatStore.getState();
  chat.setTyping(true);
  useRoxyFailure.setState({ failure: null });
  try {
    const { data, error, status } = await callEdgeFunction<{ response: string }>('roxy-chat', {
      conversation_id: conversationIdFor(userId),
      message: text,
    });
    if (error || !data?.response) {
      useRoxyFailure.setState({
        failure: { userId, text, message: status === 429 ? LIMIT_COPY : FAILED_COPY },
      });
      return false;
    }
    useRoxyChatStore.getState().addMessage({ role: 'roxy', content: data.response });
    return true;
  } catch {
    useRoxyFailure.setState({ failure: { userId, text, message: FAILED_COPY } });
    return false;
  } finally {
    useRoxyChatStore.getState().setTyping(false);
  }
}

/**
 * Send her words to Roxy AI. Her message shows at once (optimistic); Roxy's
 * reply follows. Returns whether Roxy answered. Ignores empty text and a send
 * while Roxy is still writing.
 */
export async function sendToRoxy(userId: string | null | undefined, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!userId || !trimmed || useRoxyChatStore.getState().isTyping) return false;
  useRoxyChatStore.getState().addMessage({ role: 'user', content: trimmed });
  return deliver(userId, trimmed);
}

/** Retry the failed send for this member, without repeating her message. */
export async function retryRoxy(userId: string | null | undefined): Promise<boolean> {
  const failure = failureFor(userId);
  if (!failure || useRoxyChatStore.getState().isTyping) return false;
  return deliver(failure.userId, failure.text);
}

/** Clear the chat on this phone (more › Clear chat; Settings › Delete my Roxy AI chat). */
export function clearRoxyChat(): void {
  useRoxyChatStore.getState().clear();
  useRoxyFailure.setState({ failure: null });
}

/** Unicode isolates around a member's name, so it lays out right inside any script. */
export function isolate(name: string): string {
  return `\u2068${name}\u2069`;
}

/** Her first name from a display name ("Amara Okafor" → "Amara"), or null. */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * "Hello, Roxy" greeting by time of day (design direction v2 › Signature
 * moments 1): "Evening, Amara." / "How are you, really?". The small hours get
 * a plain "Hi". Built from whole sentences per slot, never by concatenating
 * fragments of a sentence.
 */
export function greetingFor(now: Date, firstName: string | null): { line1: string; line2: string } {
  const h = now.getHours();
  const name = firstName ? isolate(firstName) : null;
  let line1: string;
  if (h >= 5 && h < 12) line1 = name ? `Morning, ${name}.` : 'Morning.';
  else if (h >= 12 && h < 18) line1 = name ? `Afternoon, ${name}.` : 'Afternoon.';
  else if (h >= 18) line1 = name ? `Evening, ${name}.` : 'Evening.';
  else line1 = name ? `Hi, ${name}.` : 'Hi.';
  return { line1, line2: 'How are you, really?' };
}

/** The three ways in (Signature moment 1). */
export const HELLO_SUGGESTIONS = [
  "I'm nervous about an event",
  'Help me write my intro',
  'I just want to talk',
] as const;

/** After her replies: two easy ways to keep going. */
export const FOLLOW_UPS = ['Tell me more', 'What would you do?'] as const;
