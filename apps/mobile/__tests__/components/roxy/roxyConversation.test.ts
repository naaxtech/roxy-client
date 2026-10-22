jest.mock('../../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));

import { callEdgeFunction } from '../../../lib/supabase';
import { useRoxyChatStore } from '../../../store/roxyChatStore';
import {
  sendToRoxy, retryRoxy, clearRoxyChat, failureFor, useRoxyFailure,
  greetingFor, firstNameOf, isolate, conversationIdFor, LIMIT_COPY, FAILED_COPY,
} from '../../../components/roxy/roxyConversation';

const call = callEdgeFunction as jest.Mock;

beforeEach(() => {
  call.mockReset();
  useRoxyChatStore.setState({ messages: [], isTyping: false, isOpen: false });
  useRoxyFailure.setState({ failure: null });
});

const roles = () => useRoxyChatStore.getState().messages.map((m) => `${m.role}:${m.content}`);

describe('sendToRoxy', () => {
  it('shows her message at once, then Roxy AI’s reply', async () => {
    let resolve!: (v: unknown) => void;
    call.mockReturnValue(new Promise((r) => { resolve = r; }));
    const sent = sendToRoxy('amara', '  I just want to talk  ');
    expect(roles()).toEqual(['user:I just want to talk']);
    expect(useRoxyChatStore.getState().isTyping).toBe(true);
    resolve({ data: { response: 'I am here. What is on your mind?' }, error: null });
    await expect(sent).resolves.toBe(true);
    expect(roles()).toEqual(['user:I just want to talk', 'roxy:I am here. What is on your mind?']);
    expect(useRoxyChatStore.getState().isTyping).toBe(false);
    expect(call).toHaveBeenCalledWith('roxy-chat', {
      conversation_id: conversationIdFor('amara'),
      message: 'I just want to talk',
    });
  });

  it('ignores empty text, a signed-out caller, and a second send while she writes', async () => {
    expect(await sendToRoxy('amara', '   ')).toBe(false);
    expect(await sendToRoxy(null, 'hi')).toBe(false);
    useRoxyChatStore.setState({ isTyping: true });
    expect(await sendToRoxy('amara', 'hi')).toBe(false);
    expect(call).not.toHaveBeenCalled();
    expect(roles()).toEqual([]);
  });

  it('a failure keeps her message and offers Retry with one sentence', async () => {
    call.mockResolvedValue({ data: null, error: 'boom', status: 500 });
    expect(await sendToRoxy('amara', 'hello')).toBe(false);
    expect(roles()).toEqual(['user:hello']);
    expect(failureFor('amara')).toEqual({ userId: 'amara', text: 'hello', message: FAILED_COPY });
    expect(useRoxyChatStore.getState().isTyping).toBe(false);
  });

  it('the daily cap says so plainly', async () => {
    call.mockResolvedValue({ data: null, error: 'limit', status: 429 });
    await sendToRoxy('amara', 'hello');
    expect(failureFor('amara')?.message).toBe(LIMIT_COPY);
  });

  it('a thrown network error is a failure too, never an unhandled rejection', async () => {
    call.mockRejectedValue(new Error('offline'));
    expect(await sendToRoxy('amara', 'hello')).toBe(false);
    expect(failureFor('amara')?.message).toBe(FAILED_COPY);
  });
});

describe('retryRoxy', () => {
  it('re-sends the failed words without repeating her message', async () => {
    call.mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });
    await sendToRoxy('amara', 'hello');
    call.mockResolvedValueOnce({ data: { response: 'Hi Amara.' }, error: null });
    expect(await retryRoxy('amara')).toBe(true);
    expect(roles()).toEqual(['user:hello', 'roxy:Hi Amara.']);
    expect(failureFor('amara')).toBeNull();
    expect(call).toHaveBeenLastCalledWith('roxy-chat', { conversation_id: 'roxy-amara', message: 'hello' });
  });

  it("never sends one member's words from another member's account", async () => {
    call.mockResolvedValueOnce({ data: null, error: 'boom', status: 500 });
    await sendToRoxy('amara', 'something private');
    expect(failureFor('mariam')).toBeNull();
    expect(await retryRoxy('mariam')).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('clearRoxyChat', () => {
  it('empties the chat and forgets a failure', async () => {
    call.mockResolvedValue({ data: null, error: 'boom', status: 500 });
    await sendToRoxy('amara', 'hello');
    clearRoxyChat();
    expect(roles()).toEqual([]);
    expect(failureFor('amara')).toBeNull();
  });
});

describe('greetingFor', () => {
  const at = (h: number) => new Date(2026, 9, 21, h, 5);

  it('greets by time of day with her first name, isolated for any script', () => {
    expect(greetingFor(at(19), 'Amara')).toEqual({
      line1: `Evening, ${isolate('Amara')}.`,
      line2: 'How are you, really?',
    });
    expect(greetingFor(at(8), 'Amara').line1).toBe(`Morning, ${isolate('Amara')}.`);
    expect(greetingFor(at(13), 'Amara').line1).toBe(`Afternoon, ${isolate('Amara')}.`);
    expect(greetingFor(at(2), 'Amara').line1).toBe(`Hi, ${isolate('Amara')}.`);
  });

  it('the hour boundaries', () => {
    expect(greetingFor(at(5), null).line1).toBe('Morning.');
    expect(greetingFor(at(11), null).line1).toBe('Morning.');
    expect(greetingFor(at(12), null).line1).toBe('Afternoon.');
    expect(greetingFor(at(17), null).line1).toBe('Afternoon.');
    expect(greetingFor(at(18), null).line1).toBe('Evening.');
    expect(greetingFor(at(23), null).line1).toBe('Evening.');
    expect(greetingFor(at(4), null).line1).toBe('Hi.');
  });

  it('isolates with U+2068 … U+2069', () => {
    expect(isolate('Inês')).toBe('\u2068Inês\u2069');
  });

  it('first name from a display name', () => {
    expect(firstNameOf('Amara Okafor')).toBe('Amara');
    expect(firstNameOf('  Mariam ')).toBe('Mariam');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
