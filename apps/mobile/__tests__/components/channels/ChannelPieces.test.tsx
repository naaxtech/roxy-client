import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChannelBar } from '../../../components/channels/ChannelBar';
import { ChannelMessage, formatTime } from '../../../components/channels/ChannelMessage';
import { ChannelComposer } from '../../../components/channels/ChannelComposer';
import { MAX_MESSAGE_LENGTH, ChannelInputError, type Channel, type ChannelMessage as Message } from '../../../lib/channels';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: 'c1', community_id: 'com1', slug: 'general',
  topic: null, position: 0, is_default: false, ...over,
});

const message = (over: Partial<Message> = {}): Message => ({
  id: 'm1', channel_id: 'c1', sender_id: 'u1', body: 'hi there',
  created_at: '2026-09-05T10:00:00Z', edited_at: null, deleted_at: null,
  author: { id: 'u1', username: 'maya', display_name: 'Maya', avatar_url: null },
  ...over,
});

describe('ChannelBar', () => {
  it('does not let a flex sibling crush it — the 6px bug MediaTypeChips shipped', () => {
    // A horizontal ScrollView has no intrinsic height on react-native-web. The
    // component rendered at 6px, invisible, with every unit test green.
    const v = render(
      <ChannelBar channels={[channel()]} activeId="c1" onSelect={() => {}} />,
    );
    const style = v.getByTestId('channel-bar').props.style;
    expect(style).toMatchObject({ flexGrow: 0, flexShrink: 0 });
  });

  it('puts the name, the role and the selected state on the FOCUSABLE node', () => {
    // Splitting them was the defect: the identity sat on an inner View while
    // the handler sat on a Pressable wrapping it, so the browser got a
    // focusable div with tabindex="0", role=null and aria-label=null, beside a
    // role="tab" that could not be focused or activated. Verified in a real
    // browser — jest sees the element tree, never the DOM, so this assertion
    // is a reminder of the shape, and tests/e2e/channel-a11y.spec.ts is the
    // check that can actually fail on it.
    const v = render(
      <ChannelBar
        channels={[channel({ id: 'c1', slug: 'general' }), channel({ id: 'c2', slug: 'rants' })]}
        activeId="c2"
        onSelect={() => {}}
      />,
    );
    // `accessibilityState` is what jest can see. The `aria-selected` half is
    // dropped from the element tree by TouchableOpacity and only appears in the
    // real DOM — `tests/e2e/channel-a11y.spec.ts` is what checks that, because
    // this renderer structurally cannot.
    expect(v.getByTestId('channel-bar-rants').props.accessibilityState).toEqual({ selected: true });
    expect(v.getByTestId('channel-bar-general').props.accessibilityState).toEqual({ selected: false });
    expect(v.getByTestId('channel-bar-rants').props.accessibilityRole).toBe('tab');
    expect(v.getByTestId('channel-bar-rants').props.accessibilityLabel).toBe('# rants');
  });

  it('hands back the channel, not an index', () => {
    const onSelect = jest.fn();
    const rants = channel({ id: 'c2', slug: 'rants' });
    const v = render(<ChannelBar channels={[channel(), rants]} activeId="c1" onSelect={onSelect} />);
    fireEvent.press(v.getByTestId('channel-bar-rants'));
    expect(onSelect).toHaveBeenCalledWith(rants);
  });

  it('shows the stage only when audio is actually live', () => {
    // A permanent stage button on a silent community advertises an empty room.
    const quiet = render(
      <ChannelBar channels={[channel()]} activeId="c1" onSelect={() => {}} stageCount={0} onJoinStage={() => {}} />,
    );
    expect(quiet.queryByTestId('channel-bar-stage')).toBeNull();

    const live = render(
      <ChannelBar channels={[channel()]} activeId="c1" onSelect={() => {}} stageCount={12} onJoinStage={() => {}} />,
    );
    expect(live.getByTestId('channel-bar-stage')).toBeTruthy();
  });
});

describe('ChannelMessage', () => {
  it('renders the author and the body', () => {
    const v = render(<ChannelMessage message={message()} testID="m" />);
    expect(v.getByText('Maya')).toBeTruthy();
    expect(v.getByText('hi there')).toBeTruthy();
  });

  it('keeps a removed message in place instead of vanishing it', () => {
    // Migration 105 soft-deletes precisely so moderating one reply does not
    // punch a hole in the conversation around it.
    const v = render(
      <ChannelMessage message={message({ deleted_at: '2026-09-05T11:00:00Z' })} testID="m" />,
    );
    expect(v.getByTestId('m-removed')).toBeTruthy();
    expect(v.queryByText('hi there')).toBeNull();
  });

  it('never shows a raw id in place of a deleted account', () => {
    const v = render(
      <ChannelMessage message={message({ sender_id: null, author: null })} testID="m" />,
    );
    expect(v.getByText('Someone who left')).toBeTruthy();
  });

  it('does not offer a profile link for an author who no longer exists', () => {
    const onPressAuthor = jest.fn();
    const v = render(
      <ChannelMessage
        message={message({ sender_id: null, author: null })}
        onPressAuthor={onPressAuthor}
        testID="m"
      />,
    );
    expect(v.queryByLabelText(/Open .* profile/)).toBeNull();
  });

  it('draws a tappable card when the body names an event', () => {
    const onOpenCard = jest.fn();
    const v = render(
      <ChannelMessage
        message={message({ body: 'tonight /event/c2fb3fd8-8528-4e69-bce6-44931b4377c4' })}
        onOpenCard={onOpenCard}
        testID="m"
      />,
    );
    fireEvent.press(v.getByTestId('m-card'));
    expect(onOpenCard).toHaveBeenCalledWith('/event/c2fb3fd8-8528-4e69-bce6-44931b4377c4');
  });

  it('does not say "edited" on a message that was removed', () => {
    const v = render(
      <ChannelMessage
        message={message({ edited_at: '2026-09-05T10:30:00Z', deleted_at: '2026-09-05T11:00:00Z' })}
        testID="m"
      />,
    );
    expect(v.queryByText('edited')).toBeNull();
  });
});

describe('formatTime', () => {
  const now = new Date('2026-09-05T18:00:00Z');

  it('shows a date for anything before today', () => {
    // Built from the timestamp's own value — never by shifting a Date across a
    // month boundary, which overflows on a day the target month lacks.
    expect(formatTime('2026-08-31T10:00:00Z', now)).toMatch(/Aug|31/);
  });

  it('returns nothing rather than "Invalid Date" on a bad timestamp', () => {
    expect(formatTime('nonsense', now)).toBe('');
  });
});

describe('ChannelComposer', () => {
  it('will not send an empty message', () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    const v = render(<ChannelComposer placeholder="Message # general" onSend={onSend} />);
    fireEvent.press(v.getByTestId('channel-composer-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends the trimmed body and clears only after it settles', async () => {
    let release: (() => void) | undefined;
    const onSend = jest.fn(() => new Promise<void>((r) => { release = r; }));
    const v = render(<ChannelComposer placeholder="Message # general" onSend={onSend} />);

    fireEvent.changeText(v.getByTestId('channel-composer-input'), '  hello  ');
    fireEvent.press(v.getByTestId('channel-composer-send'));
    expect(onSend).toHaveBeenCalledWith('hello');

    // Still in the box while the write is in flight: clearing first loses her
    // text when the send fails.
    expect(v.getByTestId('channel-composer-input').props.value).toBe('  hello  ');
    release?.();
    await waitFor(() => expect(v.getByTestId('channel-composer-input').props.value).toBe(''));
  });

  it('does not post twice on a double tap', async () => {
    // There is no unsend.
    let release: (() => void) | undefined;
    const onSend = jest.fn(() => new Promise<void>((r) => { release = r; }));
    const v = render(<ChannelComposer placeholder="Message # general" onSend={onSend} />);
    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'hi');
    fireEvent.press(v.getByTestId('channel-composer-send'));
    fireEvent.press(v.getByTestId('channel-composer-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
    release?.();
    await waitFor(() => expect(v.getByTestId('channel-composer-input').props.value).toBe(''));
  });

  it('keeps her text when the send fails, and never prints the raw error', async () => {
    // A PostgrestError is an Error subclass, so `e.message` reached the screen
    // as policy text naming the table. `.claude/rules/react.md` bans exactly
    // that, and it read to a member as though the app had broken.
    const dbError = Object.assign(
      new Error('new row violates row-level security policy for table "community_channel_messages"'),
      { code: '42501' },
    );
    const onSend = jest.fn().mockRejectedValue(dbError);
    const v = render(<ChannelComposer placeholder="Message # general" onSend={onSend} />);
    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'hi');
    fireEvent.press(v.getByTestId('channel-composer-send'));
    await waitFor(() => expect(v.getByTestId('channel-composer-error')).toBeTruthy());

    const shown = v.getByTestId('channel-composer-error').props.children as string;
    expect(shown).toBe('You do not have permission to do that here.');
    expect(shown).not.toMatch(/row-level security|community_channel_messages|policy/);
    // Her words are still hers.
    expect(v.getByTestId('channel-composer-input').props.value).toBe('hi');
  });

  it('still shows the messages the module wrote FOR her', async () => {
    // The length and empty-message guards are written to be read; only the
    // database's own text is the part that must never reach her.
    const onSend = jest.fn().mockRejectedValue(new ChannelInputError('Keep it under 2000 characters.'));
    const v = render(<ChannelComposer placeholder="Message # general" onSend={onSend} />);
    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'hi');
    fireEvent.press(v.getByTestId('channel-composer-send'));
    await waitFor(() => expect(v.getByTestId('channel-composer-error')).toBeTruthy());
    expect(v.getByText('Keep it under 2000 characters.')).toBeTruthy();
  });

  it('says how far over the limit she is instead of failing at the constraint', () => {
    const v = render(<ChannelComposer placeholder="Message # general" onSend={jest.fn()} />);
    fireEvent.changeText(v.getByTestId('channel-composer-input'), 'x'.repeat(MAX_MESSAGE_LENGTH + 7));
    expect(v.getByText('7 characters over')).toBeTruthy();
  });

  it('states the reason when she cannot post at all', () => {
    // Silence would read as a broken composer.
    const v = render(
      <ChannelComposer placeholder="x" onSend={jest.fn()} disabled disabledReason="Sign in to post here." />,
    );
    expect(v.getByText('Sign in to post here.')).toBeTruthy();
    expect(v.queryByTestId('channel-composer-send')).toBeNull();
  });
});
