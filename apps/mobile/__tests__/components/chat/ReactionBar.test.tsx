import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickReactBar, ReactionChips } from '../../../components/chat/ReactionBar';
import { MessageReaction } from '../../../types';

const makeReaction = (overrides: Partial<MessageReaction> = {}): MessageReaction => ({
  id: 'r1',
  message_id: 'msg-1',
  user_id: 'user-1',
  emoji: '❤️',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ── QuickReactBar ──────────────────────────────────────────────────────────────

describe('QuickReactBar', () => {
  it('renders 6 quick emoji buttons', () => {
    const { getByText } = render(<QuickReactBar onReact={jest.fn()} />);
    expect(getByText('❤️')).toBeTruthy();
    expect(getByText('😂')).toBeTruthy();
    expect(getByText('💜')).toBeTruthy();
  });

  it('calls onReact with the tapped emoji', () => {
    const onReact = jest.fn();
    const { getByText } = render(<QuickReactBar onReact={onReact} />);
    fireEvent.press(getByText('❤️'));
    expect(onReact).toHaveBeenCalledWith('❤️');
  });

  it('calls onReact with the correct emoji when different emoji pressed', () => {
    const onReact = jest.fn();
    const { getByText } = render(<QuickReactBar onReact={onReact} />);
    fireEvent.press(getByText('😂'));
    expect(onReact).toHaveBeenCalledWith('😂');
  });
});

// ── ReactionChips ──────────────────────────────────────────────────────────────

describe('ReactionChips', () => {
  it('renders nothing when reactions array is empty', () => {
    const { toJSON } = render(
      <ReactionChips reactions={[]} currentUserId="user-1" onToggle={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders a chip for each unique emoji', () => {
    const reactions = [
      makeReaction({ id: 'r1', user_id: 'user-1', emoji: '❤️' }),
      makeReaction({ id: 'r2', user_id: 'user-2', emoji: '😂' }),
    ];
    const { getByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={jest.fn()} />
    );
    expect(getByText('❤️')).toBeTruthy();
    expect(getByText('😂')).toBeTruthy();
  });

  it('shows count when more than one user reacts with the same emoji', () => {
    const reactions = [
      makeReaction({ id: 'r1', user_id: 'user-1', emoji: '❤️' }),
      makeReaction({ id: 'r2', user_id: 'user-2', emoji: '❤️' }),
      makeReaction({ id: 'r3', user_id: 'user-3', emoji: '❤️' }),
    ];
    const { getByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={jest.fn()} />
    );
    expect(getByText('3')).toBeTruthy();
  });

  it('does not show count when only one reactor', () => {
    const reactions = [makeReaction({ id: 'r1', user_id: 'user-1', emoji: '❤️' })];
    const { queryByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={jest.fn()} />
    );
    expect(queryByText('1')).toBeNull();
  });

  it('calls onToggle with emoji and isOwn=true when current user owns the reaction', () => {
    const onToggle = jest.fn();
    const reactions = [makeReaction({ id: 'r1', user_id: 'user-1', emoji: '❤️' })];
    const { getByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={onToggle} />
    );
    fireEvent.press(getByText('❤️'));
    expect(onToggle).toHaveBeenCalledWith('❤️', true);
  });

  it('calls onToggle with isOwn=false when current user did not react', () => {
    const onToggle = jest.fn();
    const reactions = [makeReaction({ id: 'r1', user_id: 'user-2', emoji: '❤️' })];
    const { getByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={onToggle} />
    );
    fireEvent.press(getByText('❤️'));
    expect(onToggle).toHaveBeenCalledWith('❤️', false);
  });

  it('groups reactions by emoji correctly', () => {
    const reactions = [
      makeReaction({ id: 'r1', user_id: 'user-1', emoji: '❤️' }),
      makeReaction({ id: 'r2', user_id: 'user-2', emoji: '❤️' }),
      makeReaction({ id: 'r3', user_id: 'user-3', emoji: '😂' }),
    ];
    const { getByText, queryByText } = render(
      <ReactionChips reactions={reactions} currentUserId="user-1" onToggle={jest.fn()} />
    );
    // ❤️ has 2 → shows count
    expect(getByText('2')).toBeTruthy();
    // 😂 has 1 → no count
    expect(queryByText('1')).toBeNull();
    expect(getByText('😂')).toBeTruthy();
  });
});
