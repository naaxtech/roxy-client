import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CommunityCrest } from '../../components/feed/CommunityCrest';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

const noop = (): void => undefined;

function crest(overrides: Partial<React.ComponentProps<typeof CommunityCrest>> = {}) {
  return render(
    <CommunityCrest
      name="The Sapphic Club"
      imageUrl={null}
      recyclingKey="p1"
      active={false}
      reducedMotion={false}
      onPress={noop}
      {...overrides}
    />,
  );
}

describe('CommunityCrest', () => {
  it('rotates in the sound-disc slot on the cell being looked at', () => {
    const view = crest({ active: true });

    expect(view.queryByTestId('community-crest-spinning')).not.toBeNull();
    expect(view.queryByTestId('community-crest-static')).toBeNull();
    // Unmount inside the test: a loop left running past the end of one would
    // tick into the next one's tree.
    view.unmount();
  });

  it('does not rotate on the cells the viewer is not looking at', () => {
    // Up to five cells are mounted either side of the active one. Five discs
    // turning off-screen is five animations' worth of work nobody can see.
    const view = crest({ active: false });

    expect(view.queryByTestId('community-crest-static')).not.toBeNull();
    expect(view.queryByTestId('community-crest-spinning')).toBeNull();
  });

  it('stops rotating for a viewer who asked the OS for less motion', () => {
    // A permanently spinning element is exactly the thing Reduce Motion exists
    // to stop; WCAG 2.2 SC 2.2.2 treats motion past five seconds as needing a
    // pause mechanism, and the OS setting IS that answer.
    const view = crest({ active: true, reducedMotion: true });

    expect(view.queryByTestId('community-crest-static')).not.toBeNull();
    expect(view.queryByTestId('community-crest-spinning')).toBeNull();
  });

  it('opens the community it is standing for', () => {
    const onPress = jest.fn();
    const view = crest({ onPress });

    fireEvent.press(view.getByTestId('community-crest'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('names the community it opens instead of announcing a bare image', () => {
    const view = crest();

    expect(view.getByTestId('community-crest').props.accessibilityLabel)
      .toBe('Open The Sapphic Club');
    expect(view.getByTestId('community-crest').props.accessibilityRole).toBe('button');
  });

  it('falls back to the name-hashed monogram when the community has no artwork', () => {
    const view = crest({ imageUrl: null });

    expect(view.getByTestId('community-crest-monogram').props.children).toBe('T');
    expect(view.queryByTestId('community-crest-image')).toBeNull();
  });

  it('recycling-keys the artwork so a reused cell never shows the last crest', () => {
    const view = crest({ imageUrl: 'https://cdn.example.test/crest.png', recyclingKey: 'p7' });

    expect(view.getByTestId('community-crest-image').props.recyclingKey).toBe('p7');
  });
});
