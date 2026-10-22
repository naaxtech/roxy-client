import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { Avatar, initialsOf } from '../../../components/ui/Avatar';
import { AVATAR_GRADS, avatarGradient } from '../../../lib/avatars';
import { CROSS_DISSOLVE_MS } from '../../../lib/motion';
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

  // Wave 3 (F15, motion spec §3.1 row 16): frame 1 is never blank, the
  // photo cross-dissolves in, and a recycled row never flashes.
  describe('image defaults', () => {
    beforeEach(() => { mockReduced = false; });

    it('frame 1 shows her identity colour under the photo (never a blank circle)', () => {
      const r = render(<Avatar uri="https://x/f1.jpg" name="Maya Lin" seed="u-1" />);
      const style = StyleSheet.flatten(r.getByTestId('avatar-photo').props.style);
      expect(style.backgroundColor).toBe(avatarGradient('u-1')[0]);
    });

    it('a first-time photo cross-dissolves in over CROSS_DISSOLVE_MS', () => {
      const r = render(<Avatar uri="https://x/new.jpg" name="Jo" />);
      expect(r.getByTestId('avatar-photo').props.transition).toBe(CROSS_DISSOLVE_MS);
    });

    it('recycled rows key the image by its URL and keep it in memory', () => {
      const r = render(<Avatar uri="https://x/rk.jpg" name="Jo" />);
      const img = r.getByTestId('avatar-photo');
      expect(img.props.recyclingKey).toBe('https://x/rk.jpg');
      expect(img.props.cachePolicy).toBe('memory-disk');
    });

    it('a photo this session has already painted comes back with no fade (no flicker on recycle)', () => {
      const first = render(<Avatar uri="https://x/seen.jpg" name="Jo" />);
      fireEvent(first.getByTestId('avatar-photo'), 'load', { source: { url: 'https://x/seen.jpg' } });
      first.unmount();
      const again = render(<Avatar uri="https://x/seen.jpg" name="Jo" />);
      expect(again.getByTestId('avatar-photo').props.transition).toBe(0);
    });

    it('Reduce Motion: no fade', () => {
      mockReduced = true;
      const r = render(<Avatar uri="https://x/rm.jpg" name="Jo" />);
      expect(r.getByTestId('avatar-photo').props.transition).toBe(0);
    });
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
