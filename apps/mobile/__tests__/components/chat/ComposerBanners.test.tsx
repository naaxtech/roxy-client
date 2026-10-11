/**
 * The strip above the composer: what she is replying to / editing, the
 * request gate when a stranger wrote to her, and the notices that replace
 * the composer when she cannot (or can only partly) write.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));

import { ReplyBar, RequestGate, ThreadNotice } from '../../../components/chat/ComposerBanners';

describe('ReplyBar', () => {
  it('shows who and what she is replying to, and can be cancelled', () => {
    const onCancel = jest.fn();
    const { getByText, getByLabelText } = render(
      <ReplyBar mode="reply" name="Ana" text="want to grab coffee?" onCancel={onCancel} />,
    );
    expect(getByText('Replying to Ana')).toBeTruthy();
    expect(getByText('want to grab coffee?')).toBeTruthy();
    fireEvent.press(getByLabelText('Cancel reply'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('edit mode says so', () => {
    const { getByText, getByLabelText } = render(
      <ReplyBar mode="edit" name="" text="old words" onCancel={jest.fn()} />,
    );
    expect(getByText('Editing message')).toBeTruthy();
    expect(getByLabelText('Cancel edit')).toBeTruthy();
  });
});

describe('RequestGate', () => {
  const h = () => ({ onAccept: jest.fn(), onDelete: jest.fn(), onBlock: jest.fn() });

  it('explains it is a request and offers accept / delete / block', () => {
    const fns = h();
    const { getByText, getByTestId } = render(<RequestGate name="Sam" busy={false} {...fns} />);
    expect(getByText(/Sam wants to message you/)).toBeTruthy();
    expect(getByText(/won't know you've seen this/i)).toBeTruthy();
    fireEvent.press(getByTestId('request-gate-accept'));
    fireEvent.press(getByTestId('request-gate-delete'));
    fireEvent.press(getByTestId('request-gate-block'));
    expect(fns.onAccept).toHaveBeenCalled();
    expect(fns.onDelete).toHaveBeenCalled();
    expect(fns.onBlock).toHaveBeenCalled();
  });

  it('does nothing twice while an answer is in flight', () => {
    const fns = h();
    const { getByTestId } = render(<RequestGate name="Sam" busy {...fns} />);
    fireEvent.press(getByTestId('request-gate-accept'));
    expect(fns.onAccept).not.toHaveBeenCalled();
  });
});

describe('ThreadNotice', () => {
  it('outgoing request: says how many are left and that it is text only', () => {
    const { getByText } = render(<ThreadNotice kind="outgoing_request" remaining={2} name="Sam" />);
    expect(getByText(/Message request/)).toBeTruthy();
    expect(getByText(/2 messages left until Sam accepts/)).toBeTruthy();
  });

  it('outgoing request at the cap: waiting', () => {
    const { getByText } = render(<ThreadNotice kind="outgoing_request" remaining={0} name="Sam" />);
    expect(getByText(/Waiting for Sam to accept/)).toBeTruthy();
  });

  it('left / removed', () => {
    expect(render(<ThreadNotice kind="gone" reason="left" />).getByText('You left this group')).toBeTruthy();
    expect(render(<ThreadNotice kind="gone" reason="removed" />).getByText("You're no longer in this group")).toBeTruthy();
  });
});
