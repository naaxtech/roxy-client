import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import { EventModeBadge, eventModeLabel } from '../../../components/events/EventModeBadge';
import { THEMES } from '../../../lib/theme';

/**
 * Whether an event is something you travel to or something you open is the
 * single most consequential fact on an event card — it decides whether she
 * books a train. It may never be carried by colour alone.
 */
describe('EventModeBadge', () => {
  it('always prints the word, for every mode', () => {
    const inPerson = render(<EventModeBadge mode="in_person" />);
    expect(inPerson.getByText('IN PERSON')).toBeTruthy();

    const online = render(<EventModeBadge mode="online" />);
    expect(online.getByText('ONLINE')).toBeTruthy();

    const hybrid = render(<EventModeBadge mode="hybrid" />);
    expect(hybrid.getByText('BOTH')).toBeTruthy();
  });

  /**
   * A hybrid event is genuinely both. Labelling it as one or the other would
   * send her to a venue for something she could have watched from bed, or keep
   * her at home when there was a room full of people.
   */
  it('gives hybrid its own word rather than picking a side', () => {
    expect(eventModeLabel('hybrid')).not.toBe(eventModeLabel('online'));
    expect(eventModeLabel('hybrid')).not.toBe(eventModeLabel('in_person'));
  });

  it('spells the mode out for a screen reader', () => {
    const { getByTestId } = render(<EventModeBadge mode="in_person" />);
    expect(String(getByTestId('event-mode-badge').props.accessibilityLabel))
      .toMatch(/in person/i);
  });

  it('separates the two main modes by colour as well, as a second signal', () => {
    const inPerson = render(<EventModeBadge mode="in_person" />);
    const online = render(<EventModeBadge mode="online" />);

    const inPersonBg = inPerson.getByTestId('event-mode-badge').props.style.backgroundColor;
    const onlineBg = online.getByTestId('event-mode-badge').props.style.backgroundColor;

    expect(inPersonBg).not.toBe(onlineBg);
    // The design's pairing: in-person pink, online lilac.
    expect(inPersonBg).toBe(THEMES.dark.primary);
    expect(onlineBg).toBe(THEMES.dark.secondary);
  });

  it('never renders an empty badge for an unexpected value', () => {
    // The column is NOT NULL with a default, but a widened enum or a bad row
    // must not produce a blank pill that means nothing.
    const { getByTestId } = render(
      <EventModeBadge mode={'teleport' as unknown as 'online'} />
    );
    expect(String(getByTestId('event-mode-badge-text').props.children).length)
      .toBeGreaterThan(0);
  });
});
