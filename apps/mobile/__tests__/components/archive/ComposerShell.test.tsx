import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ComposerShell } from '../../../components/archive/ComposerShell';

const onClose = jest.fn();

beforeEach(() => {
  onClose.mockClear();
});

describe('ComposerShell', () => {
  it('always shows the title and intro, locked or not', () => {
    const { getByText } = render(
      <ComposerShell title="Write a review" intro="your review shows next to your score" locked={false} onClose={onClose} />
    );
    expect(getByText('Write a review')).toBeTruthy();
    expect(getByText('your review shows next to your score')).toBeTruthy();
  });

  it('shows the pending explanation instead of the form when locked, never a dead control', () => {
    const { getByTestId, queryByTestId } = render(
      <ComposerShell
        title="Write a review"
        intro="intro"
        locked
        onClose={onClose}
        testID="review-sheet"
      >
        <Text testID="the-form">the form</Text>
      </ComposerShell>
    );
    expect(getByTestId('review-sheet-locked')).toBeTruthy();
    expect(queryByTestId('the-form')).toBeNull();
  });

  it('shows the form, error and foot note when unlocked', () => {
    const { getByTestId, getByText, queryByTestId } = render(
      <ComposerShell
        title="Write a review"
        intro="intro"
        locked={false}
        onClose={onClose}
        error="Something went wrong"
        footNote="Reviews are public and editable."
        testID="review-sheet"
      >
        <Text testID="the-form">the form</Text>
      </ComposerShell>
    );
    expect(getByTestId('the-form')).toBeTruthy();
    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText('Reviews are public and editable.')).toBeTruthy();
    expect(queryByTestId('review-sheet-locked')).toBeNull();
  });

  it('calls onClose from the close control', () => {
    const { getByLabelText } = render(
      <ComposerShell title="t" intro="i" locked={false} onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
