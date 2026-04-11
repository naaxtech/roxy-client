import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

// eslint-disable-next-line import/first
import { CommunityRoomCard } from '../../components/community/CommunityRoomCard';

const base = {
  id: 'r1',
  name: 'Gaming Night Hangout',
  description: 'Chill voice while we game',
  room_type: 'audio' as const,
  status: 'live' as const,
  scheduled_at: null,
  community_name: 'Queer Gamers',
  creator_display_name: 'Sam',
  onPress: jest.fn(),
};

describe('CommunityRoomCard', () => {
  it('renders room name and description', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('Gaming Night Hangout')).toBeTruthy();
    expect(getByText('Chill voice while we game')).toBeTruthy();
  });

  it('shows Live badge for live rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('● Live')).toBeTruthy();
  });

  it('shows scheduled time for scheduled rooms', () => {
    const { getByTestId } = render(
      <CommunityRoomCard
        {...base}
        status="scheduled"
        scheduled_at="2026-04-19T19:00:00Z"
      />
    );
    expect(getByTestId('scheduled-badge')).toBeTruthy();
  });

  it('calls onPress for live rooms', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<CommunityRoomCard {...base} onPress={onPress} />);
    fireEvent.press(getByTestId('room-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress for scheduled rooms', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <CommunityRoomCard {...base} status="scheduled" scheduled_at="2026-04-19T19:00:00Z" onPress={onPress} />
    );
    fireEvent.press(getByTestId('room-card'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows community and host info', () => {
    const { getByText } = render(<CommunityRoomCard {...base} />);
    expect(getByText('🏘 Queer Gamers')).toBeTruthy();
    expect(getByText('👑 Sam')).toBeTruthy();
  });

  it('shows audio icon for audio rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} room_type="audio" />);
    expect(getByText('🎙️')).toBeTruthy();
  });

  it('shows video icon for video rooms', () => {
    const { getByText } = render(<CommunityRoomCard {...base} room_type="video" />);
    expect(getByText('🎥')).toBeTruthy();
  });
});
