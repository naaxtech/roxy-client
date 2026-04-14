import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChipSearchBar } from '../../../components/build/ChipSearchBar';

describe('ChipSearchBar', () => {
  it('calls onAddChip when user submits a search term', () => {
    const onAddChip = jest.fn();
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={onAddChip} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, 'wellness');
    fireEvent(input, 'submitEditing');
    expect(onAddChip).toHaveBeenCalledWith('wellness');
  });

  it('does not call onAddChip for empty string', () => {
    const onAddChip = jest.fn();
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={onAddChip} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');
    expect(onAddChip).not.toHaveBeenCalled();
  });

  it('renders chips and calls onRemoveChip when × is pressed', () => {
    const onRemoveChip = jest.fn();
    const { getByText, getAllByText } = render(
      <ChipSearchBar
        chips={['wellness', 'coaching']}
        onAddChip={jest.fn()}
        onRemoveChip={onRemoveChip}
      />
    );
    expect(getByText('wellness')).toBeTruthy();
    fireEvent.press(getAllByText('×')[0]);
    expect(onRemoveChip).toHaveBeenCalledWith('wellness');
  });

  it('clears input after chip is added', () => {
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={jest.fn()} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, 'wellness');
    fireEvent(input, 'submitEditing');
    expect(input.props.value).toBe('');
  });
});
