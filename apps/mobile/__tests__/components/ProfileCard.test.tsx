import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('../../lib/supabase', () => {
  const limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const order = jest.fn(() => ({ limit }));
  const inFn = jest.fn(() => ({ order }));
  const notFn = jest.fn(() => ({ in: inFn, order }));
  const eq = jest.fn(() => ({ not: notFn, in: inFn, order }));
  const select = jest.fn(() => ({ eq }));
  return {
    supabase: {
      from: jest.fn(() => ({ select })),
    },
  };
});

import { ProfileCard } from '../../components/profile/ProfileCard';
import type { Profile } from '../../types';

const baseProfile: Profile = {
  id: 'u1',
  username: 'testuser',
  display_name: 'Test User',
  bio: 'Hello world',
  avatar_url: null,
  pronouns: ['she/her'],
  identity_labels: ['lesbian'],
  onboarding_completed: true,
  is_dating_mode: false,
  interests: [],
  dating_looking_for: [],
  age_min_pref: 18,
  age_max_pref: 35,
  location_city: null,
  location_country: null,
  is_verified: false,
  is_active: true,
  last_seen_at: '2026-01-01T00:00:00Z',
  gamification_points: 125,
  badge_ids: [],
  push_token: null,
  notification_preferences: {},
  is_ghost: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('ProfileCard', () => {
  it('renders display name and username', async () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('Test User')).toBeTruthy();
    expect(getByText('@testuser')).toBeTruthy();
  });

  it('renders bio when About tab is active', async () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    fireEvent.press(getByText('About'));
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('renders pronouns and identity chips', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('she/her')).toBeTruthy();
    expect(getByText('lesbian')).toBeTruthy();
  });

  it('shows Edit Profile button when isOwn=true', () => {
    const onEdit = jest.fn();
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={true} onEdit={onEdit} />
    );
    expect(getByText('Edit Profile')).toBeTruthy();
  });

  it('hides Edit Profile button when isOwn=false', () => {
    const { queryByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(queryByText('Edit Profile')).toBeNull();
  });

  it('calls onEdit when Edit Profile is pressed', () => {
    const onEdit = jest.fn();
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={true} onEdit={onEdit} />
    );
    fireEvent.press(getByText('Edit Profile'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when back button is pressed', () => {
    const onBack = jest.fn();
    const { getByTestId } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} onBack={onBack} />
    );
    fireEvent.press(getByTestId('back-btn'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders initials avatar when no avatar_url', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(getByText('T')).toBeTruthy();
  });

  it('renders preset emoji avatar when avatar_url is avatar://', () => {
    const { getByText } = render(
      <ProfileCard profile={{ ...baseProfile, avatar_url: 'avatar://🐱' }} badges={[]} isOwn={false} />
    );
    expect(getByText('🐱')).toBeTruthy();
  });

  it('shows level and points in About tab', () => {
    const { getByText } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    fireEvent.press(getByText('About'));
    expect(getByText('🌸 Bloom · 125 pts')).toBeTruthy();
  });

  it('hides the government-verified badge when gov_verified is false/undefined', () => {
    const { queryByTestId } = render(
      <ProfileCard profile={baseProfile} badges={[]} isOwn={false} />
    );
    expect(queryByTestId('gov-verified-badge')).toBeNull();
  });

  it('shows the government-verified badge when gov_verified is true', () => {
    const { getByTestId } = render(
      <ProfileCard profile={{ ...baseProfile, gov_verified: true }} badges={[]} isOwn={false} />
    );
    const badge = getByTestId('gov-verified-badge');
    expect(badge.props.accessibilityLabel).toBe('Government verified');
  });
});
