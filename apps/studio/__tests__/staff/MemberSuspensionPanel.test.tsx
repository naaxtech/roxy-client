import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemberSuspensionPanel } from '@/app/(dashboard)/staff/members/MemberSuspensionPanel';

const mockSuspend = jest.fn();
const mockUnsuspend = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/app/(dashboard)/staff/members/actions', () => ({
  suspendMember: (...args: unknown[]) => mockSuspend(...args),
  unsuspendMember: (...args: unknown[]) => mockUnsuspend(...args),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: mockRefresh })),
}));

const ID = '4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

beforeEach(() => {
  mockSuspend.mockReset();
  mockUnsuspend.mockReset();
  mockRefresh.mockReset();
});

describe('MemberSuspensionPanel', () => {
  it('suspends with reason and optional end date, and shows the server result', async () => {
    mockSuspend.mockResolvedValue({ ok: true, message: 'Suspended. She is signed out everywhere and cannot sign back in.' });
    render(<MemberSuspensionPanel userId={ID} name="Jess" suspended={false} viewerIsCore={false} isSelf={false} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'harassment' } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2099-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Jess' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Suspended.'));
    expect(mockSuspend).toHaveBeenCalledWith(ID, 'harassment', '2099-01-31');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('blocks a too-short reason in the browser', () => {
    render(<MemberSuspensionPanel userId={ID} name="Jess" suspended={false} viewerIsCore={false} isSelf={false} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Jess' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/reason/i);
    expect(mockSuspend).not.toHaveBeenCalled();
  });

  it('shows the server refusal', async () => {
    mockSuspend.mockResolvedValue({ ok: false, error: 'Only core staff can suspend a staff member' });
    render(<MemberSuspensionPanel userId={ID} name="Pat" suspended={false} viewerIsCore={false} isSelf={false} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'harassment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend Pat' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only core staff can suspend a staff member'));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('offers lifting to core only', async () => {
    const { rerender } = render(
      <MemberSuspensionPanel userId={ID} name="Jess" suspended viewerIsCore={false} isSelf={false} />,
    );
    expect(screen.queryByRole('button', { name: /lift/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only core staff can lift/i)).toBeInTheDocument();

    rerender(<MemberSuspensionPanel userId={ID} name="Jess" suspended viewerIsCore isSelf={false} />);
    mockUnsuspend.mockResolvedValue({ ok: true, message: 'Suspension lifted. She can sign in again.' });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'appeal upheld' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lift suspension' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Suspension lifted.'));
    expect(mockUnsuspend).toHaveBeenCalledWith(ID, 'appeal upheld');
  });

  it('never offers to suspend yourself', () => {
    render(<MemberSuspensionPanel userId={ID} name="Me" suspended={false} viewerIsCore isSelf />);
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument();
  });
});
