import React from 'react';
import { render } from '@testing-library/react-native';
import { TypingIndicator } from '../../../components/chat/TypingIndicator';

describe('TypingIndicator', () => {
  it('renders nothing when visible is false', () => {
    const { toJSON } = render(
      <TypingIndicator partnerName="Alex" visible={false} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders the partner name when visible', () => {
    const { getByText } = render(
      <TypingIndicator partnerName="Alex" visible={true} />
    );
    expect(getByText('Alex')).toBeTruthy();
  });

  it('renders "is typing" text when visible', () => {
    const { getByText } = render(
      <TypingIndicator partnerName="Sam" visible={true} />
    );
    expect(getByText(' is typing')).toBeTruthy();
  });

  it('renders three animated dots when visible', () => {
    const { getAllByText } = render(
      <TypingIndicator partnerName="Alex" visible={true} />
    );
    const dots = getAllByText('.');
    expect(dots).toHaveLength(3);
  });

  it('updates displayed name when partnerName prop changes', () => {
    const { rerender, getByText, queryByText } = render(
      <TypingIndicator partnerName="Alex" visible={true} />
    );
    expect(getByText('Alex')).toBeTruthy();
    rerender(<TypingIndicator partnerName="Jordan" visible={true} />);
    expect(getByText('Jordan')).toBeTruthy();
    expect(queryByText('Alex')).toBeNull();
  });

  it('disappears when visible switches to false', () => {
    const { rerender, toJSON } = render(
      <TypingIndicator partnerName="Alex" visible={true} />
    );
    rerender(<TypingIndicator partnerName="Alex" visible={false} />);
    expect(toJSON()).toBeNull();
  });
});
