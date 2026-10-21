/**
 * v2 visual-check regressions found on the Wave 1 web export (81f024e):
 * - a flat identity room cover sat under a black veil and read as mud;
 * - the profile cover's icon buttons drew white glyphs on a light plate, and
 *   the self "Edit" label was white on a pale pinkContainer.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

type HostNode = { type: unknown; props: Record<string, unknown> };
import { CommunityRoomCard } from '../../components/community/CommunityRoomCard';
import { ProfileShell } from '../../components/profile/ProfileShell';
import { THEMES, contrastRatio, pinkFill, scrim } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));

const room = {
  id: 'r1', name: 'Audio Hangout', description: 'Open voice room', room_type: 'audio' as const,
  status: 'live' as const, scheduled_at: null, community_name: 'WLW London',
  creator_display_name: 'Sam', onPress: jest.fn(),
};

beforeEach(() => useThemeStore.setState({ theme: 'light' }));

describe('room cover veil (v2)', () => {
  // The veil is the one full-bleed View filled with scrim(0.28).
  const veils = (v: ReturnType<typeof render>) =>
    v.UNSAFE_root.findAll(
      (n: HostNode) => typeof n.type === 'string' && (StyleSheet.flatten(n.props.style as never) as { backgroundColor?: string } | undefined)?.backgroundColor === scrim(0.28)
    ).length;

  it('draws no veil over a flat identity cover', () => {
    expect(veils(render(<CommunityRoomCard {...room} />))).toBe(0);
  });

  it('keeps the veil over a banner photo (a media scrim)', () => {
    expect(veils(render(<CommunityRoomCard {...room} banner_url="https://example.com/b.jpg" />))).toBe(1);
  });
});

describe('profile cover controls (v2)', () => {
  const shell = (theme: 'light' | 'dark') => {
    useThemeStore.setState({ theme });
    return render(
      <ProfileShell
        variant="self"
        name="E2E Playwright"
        stats={[]}
        primaryAction={{ label: 'Edit', onPress: jest.fn() }}
        populated={{ posts: true, thoughts: false, shop: false, events: false, rooms: false, games: false, about: false, saved: false }}
        renderTab={() => null}
        onBack={jest.fn()}
        headerActions={[{ icon: 'ellipsis-horizontal', label: 'More options', onPress: jest.fn(), testID: 'profile-more' }]}
      />
    );
  };

  it.each(['light', 'dark'] as const)('inks the cover buttons with ink, not white (%s)', (theme) => {
    const v = shell(theme);
    for (const id of ['profile-back', 'profile-more']) {
      const glyph = v.getByTestId(id).findAll((n: HostNode) => n.props.name !== undefined && n.props.size !== undefined)[0];
      expect(glyph.props.color).toBe(THEMES[theme].ink);
    }
  });

  it.each(['light', 'dark'] as const)('draws the self Edit action on flat pink with onPink ink (%s)', (theme) => {
    const v = shell(theme);
    const label = v.getByText('Edit');
    expect(StyleSheet.flatten(label.props.style).color).toBe(THEMES[theme].onPink);
    expect(label.parent?.parent?.props.colors).toEqual(pinkFill(THEMES[theme]));
    expect(contrastRatio(THEMES[theme].onPink, THEMES[theme].pink)).toBeGreaterThanOrEqual(4.5);
  });
});
