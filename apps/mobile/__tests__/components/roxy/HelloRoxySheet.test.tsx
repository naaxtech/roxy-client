import React from 'react';
import { render, fireEvent, act, configure } from '@testing-library/react-native';

configure({ defaultIncludeHiddenElements: true });

jest.mock('react-native-svg', () => ({
  __esModule: true, default: 'Svg', Circle: 'Circle', Ellipse: 'Ellipse', Path: 'Path', G: 'G',
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../lib/supabase', () => ({ callEdgeFunction: jest.fn() }));

import { HelloRoxySheet } from '../../../components/roxy/HelloRoxySheet';
import { callEdgeFunction } from '../../../lib/supabase';
import { useRoxyChatStore } from '../../../store/roxyChatStore';
import { isolate } from '../../../components/roxy/roxyConversation';

const call = callEdgeFunction as jest.Mock;
const EVENING = new Date(2026, 9, 21, 21, 14);

function open(overrides: Partial<React.ComponentProps<typeof HelloRoxySheet>> = {}) {
  const onClose = jest.fn();
  const onOpenChat = jest.fn();
  const view = render(
    <HelloRoxySheet
      visible
      userId="amara"
      firstName="Amara"
      now={EVENING}
      onClose={onClose}
      onOpenChat={onOpenChat}
      {...overrides}
    />,
  );
  return { ...view, onClose, onOpenChat };
}

beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({ data: { response: 'Tell me about it.' }, error: null });
  useRoxyChatStore.setState({ messages: [], isTyping: false });
});

/**
 * Signature moment 1, "Hello, Roxy" (board v2-01). She taps the O; the sheet
 * rises with Roxy's face on its top edge, greets her by name for the time of
 * day, offers three ways in, and is honest about being an AI.
 */
describe('HelloRoxySheet', () => {
  it('greets her by name for the time of day, line by line', () => {
    const { getByText } = open();
    expect(getByText(`Evening, ${isolate('Amara')}.`)).toBeTruthy();
    expect(getByText('How are you, really?')).toBeTruthy();
    expect(getByText("I'm here for the big stuff and the small stuff. Pick one or just start typing.")).toBeTruthy();
  });

  it('names her, says who sees it, and that she is an AI', () => {
    const { getByText } = open();
    expect(getByText('Roxy AI')).toBeTruthy();
    expect(getByText('Only you see this chat.')).toBeTruthy();
    expect(getByText('Roxy AI is an AI and can get things wrong.')).toBeTruthy();
  });

  it('wears the 80 dp Roxy O on the sheet edge, happy to see her', () => {
    const { getByTestId } = open();
    const avatar = getByTestId('hello-roxy-avatar');
    expect(avatar.props.style).toEqual(expect.objectContaining({ width: 80, height: 80 }));
    // Reduce Motion here: the morph lands at once, and she is happy.
    expect(getByTestId('hello-roxy-avatar-happy')).toBeTruthy();
  });

  it('offers three suggestions', () => {
    const { getByText } = open();
    for (const s of ["I'm nervous about an event", 'Help me write my intro', 'I just want to talk']) {
      expect(getByText(s)).toBeTruthy();
    }
  });

  it('never calls her an assistant or a chatbot, never "ask me anything" or "always on"', () => {
    const { toJSON } = open();
    const text = JSON.stringify(toJSON()).toLowerCase();
    for (const banned of ['assistant', 'chatbot', 'ask me anything', 'always on', 'wingwoman']) {
      expect(text).not.toContain(banned);
    }
  });

  it('a suggestion starts the conversation and opens the full chat', async () => {
    const { getByText, onOpenChat } = open();
    await act(async () => { fireEvent.press(getByText('I just want to talk')); });
    expect(useRoxyChatStore.getState().messages[0]).toEqual(
      expect.objectContaining({ role: 'user', content: 'I just want to talk' }),
    );
    expect(call).toHaveBeenCalledWith('roxy-chat', expect.objectContaining({ message: 'I just want to talk' }));
    expect(onOpenChat).toHaveBeenCalled();
  });

  it('the composer says "Message Roxy AI" and sends what she typed', async () => {
    const { getByPlaceholderText, getByTestId, onOpenChat } = open();
    const input = getByPlaceholderText('Message Roxy AI');
    fireEvent.changeText(input, 'Long day.');
    await act(async () => { fireEvent.press(getByTestId('hello-roxy-send')); });
    expect(useRoxyChatStore.getState().messages[0].content).toBe('Long day.');
    expect(onOpenChat).toHaveBeenCalled();
  });

  it('send waits until there is something to send', () => {
    const { getByTestId } = open();
    expect(getByTestId('hello-roxy-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('the handle opens the full chat without sending anything', () => {
    const { getByTestId, onOpenChat } = open();
    fireEvent.press(getByTestId('hello-roxy-expand'));
    expect(onOpenChat).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it('close and the scrim both close it', () => {
    const { getByLabelText, getByTestId, onClose } = open();
    fireEvent.press(getByLabelText('Close'));
    fireEvent.press(getByTestId('hello-roxy-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('works without a name: a plain greeting, never "undefined"', () => {
    const { getByText, queryByText } = open({ firstName: null });
    expect(getByText('Evening.')).toBeTruthy();
    expect(queryByText(/undefined|null/)).toBeNull();
  });

  it('renders nothing while closed', () => {
    const { queryByText } = open({ visible: false });
    expect(queryByText('Roxy AI')).toBeNull();
  });
});
