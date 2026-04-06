import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BadgeRow } from '../../components/profile/BadgeRow';
import type { UserBadgeProgress, Badge } from '../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

function makeBadge(id: string, emoji: string, earned: boolean): EarnedBadge {
  return {
    user_id: 'u1',
    badge_id: id,
    current_value: 1,
    earned_at: earned ? '2026-01-01T00:00:00Z' : null,
    badges: {
      id,
      name: `Badge ${id}`,
      description: `Desc ${id}`,
      emoji,
      category: 'milestone',
      points_value: 10,
      requirement_type: 'connections',
      requirement_threshold: 1,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

describe('BadgeRow', () => {
  it('renders nothing when no earned badges', () => {
    const { toJSON } = render(<BadgeRow badges={[makeBadge('1', '🏅', false)]} />);
    expect(toJSON()).toBeNull();
  });

  it('renders only earned badges', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true), makeBadge('2', '⚡', false)]} />
    );
    expect(getByText('💜')).toBeTruthy();
    expect(queryByText('⚡')).toBeNull();
  });

  it('shows +N overflow when more than 5 earned badges', () => {
    const badges = Array.from({ length: 7 }, (_, i) =>
      makeBadge(String(i), '🏅', true)
    );
    const { getByText } = render(<BadgeRow badges={badges} />);
    expect(getByText('+2')).toBeTruthy();
  });

  it('shows tooltip name+description on tap', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true)]} />
    );
    expect(queryByText('Badge 1')).toBeNull();
    fireEvent.press(getByText('💜'));
    expect(getByText('Badge 1')).toBeTruthy();
    expect(getByText('Desc 1')).toBeTruthy();
  });

  it('dismisses tooltip when same badge tapped again', () => {
    const { getByText, queryByText } = render(
      <BadgeRow badges={[makeBadge('1', '💜', true)]} />
    );
    fireEvent.press(getByText('💜'));
    expect(getByText('Badge 1')).toBeTruthy();
    fireEvent.press(getByText('💜'));
    expect(queryByText('Badge 1')).toBeNull();
  });
});
