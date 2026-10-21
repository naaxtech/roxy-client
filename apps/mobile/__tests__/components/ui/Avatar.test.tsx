import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Avatar, initialsOf } from '../../../components/ui/Avatar';
import { AVATAR_GRADS } from '../../../lib/avatars';
import { BRAND_GRADIENT, LIVE_GRADIENT, IDENTITY, THEMES, worstContrast, inkOnGradient } from '../../../lib/theme';

describe('Avatar (delight: initials gradient from theme tokens)', () => {
  it('a photo renders the photo', () => {
    const r = render(<Avatar uri="https://x/a.jpg" name="Maya Lin" />);
    expect(r.getByTestId('avatar-photo')).toBeTruthy();
  });

  it('no photo -> initials on a gradient', () => {
    const r = render(<Avatar uri={null} name="Maya Lin" size={48} />);
    expect(r.getByTestId('avatar-initials')).toBeTruthy();
    expect(r.getByText('ML')).toBeTruthy();
    expect(StyleSheet.flatten(r.getByTestId('avatar-initials').props.style)).toEqual(expect.objectContaining({ width: 48, height: 48, borderRadius: 24 }));
  });

  it('a photo that fails to load falls back to initials', () => {
    const r = render(<Avatar uri="https://x/broken.jpg" name="Jo" />);
    fireEvent(r.getByTestId('avatar-photo'), 'error');
    expect(r.getByText('J')).toBeTruthy();
  });

  it('a preset renders its emoji', () => {
    const r = render(<Avatar uri="avatar://🦊" name="Jo" />);
    expect(r.getByText('🦊')).toBeTruthy();
  });

  it('initialsOf', () => {
    expect(initialsOf('maya')).toBe('M');
    expect(initialsOf('  maya  van der lin ')).toBe('ML');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });

  it('every gradient stop is a theme token, and its ink clears 3:1 (large text)', () => {
    const tokens = new Set<string>([
      // v2: avatars are identity fills, so the identity palette is a token set.
      ...BRAND_GRADIENT, ...LIVE_GRADIENT, ...IDENTITY,
      ...Object.values(THEMES.dark), ...Object.values(THEMES.light),
    ].map((c) => c.toUpperCase()));
    for (const pair of AVATAR_GRADS) {
      for (const stop of pair) expect(tokens.has(stop.toUpperCase())).toBe(true);
      expect(worstContrast(inkOnGradient(pair, 3), pair)).toBeGreaterThanOrEqual(3);
    }
  });
});
