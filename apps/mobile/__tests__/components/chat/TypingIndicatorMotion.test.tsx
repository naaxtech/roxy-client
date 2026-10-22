import React from 'react';
import { render } from '@testing-library/react-native';

/**
 * TypingIndicator on the motion tokens (spec §3.1 #10, F12): the three dots
 * bob on reanimated (UI thread) with `SPRING` tokens, never legacy
 * tension/friction springs, and under Reduce Motion the loop does not run at
 * all (loops are static).
 */

const mockCalls: { repeat: number; springs: unknown[] } = { repeat: 0, springs: [] };
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: { View, Text },
    useSharedValue: (v: number) => ({ value: v }),
    useAnimatedStyle: (f: () => unknown) => f(),
    withRepeat: (a: unknown) => { mockCalls.repeat += 1; return a; },
    withSequence: (...a: unknown[]) => a[a.length - 1],
    withDelay: (_d: number, a: unknown) => a,
    withSpring: (to: number, cfg: unknown) => { mockCalls.springs.push(cfg); return to; },
    cancelAnimation: () => undefined,
  };
});
let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));

import { TypingIndicator } from '../../../components/chat/TypingIndicator';
import { SPRING } from '../../../lib/motion';

beforeEach(() => {
  mockCalls.repeat = 0;
  mockCalls.springs = [];
  mockReduced = false;
});

describe('TypingIndicator motion', () => {
  it('bobs three dots in a loop on SPRING tokens', () => {
    render(<TypingIndicator partnerName="Alex" visible />);
    expect(mockCalls.repeat).toBe(3);
    const tokens = Object.values(SPRING);
    expect(mockCalls.springs.length).toBeGreaterThan(0);
    for (const cfg of mockCalls.springs) expect(tokens).toContainEqual(cfg);
  });

  it('under Reduce Motion the dots stay still: no loop starts', () => {
    mockReduced = true;
    const v = render(<TypingIndicator partnerName="Alex" visible />);
    expect(mockCalls.repeat).toBe(0);
    expect(mockCalls.springs).toHaveLength(0);
    // Still says who is typing.
    expect(v.getByText('Alex')).toBeTruthy();
    expect(v.getAllByText('.')).toHaveLength(3);
  });

  it('starts nothing while hidden', () => {
    render(<TypingIndicator partnerName="Alex" visible={false} />);
    expect(mockCalls.repeat).toBe(0);
  });
});
