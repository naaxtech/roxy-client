import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  LaunchAccessClient,
  setAccessTierErrorMessage,
  type LaunchMember,
} from '@/app/(dashboard)/staff/launch/LaunchAccessClient';

const mockRpc = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: jest.fn(), push: mockPush, replace: mockReplace })),
}));

const MEMBERS: LaunchMember[] = [
  {
    id: 'u1',
    displayName: 'Maya',
    username: 'maya',
    accessTier: 'public',
    vettingStatus: 'approved',
    createdLabel: '1 Sep 2026',
  },
  {
    id: 'u2',
    displayName: 'Ari',
    username: 'ari',
    accessTier: 'beta',
    vettingStatus: 'approved',
    createdLabel: '2 Sep 2026',
  },
];

describe('setAccessTierErrorMessage', () => {
  it('maps not-authorised without leaking a Postgres code', () => {
    const msg = setAccessTierErrorMessage('not authorised to set access tier');
    expect(msg).not.toMatch(/42501/);
    expect(msg.toLowerCase()).toContain('not authorised');
  });

  it('maps an invalid tier', () => {
    expect(setAccessTierErrorMessage('invalid access tier')).toMatch(/public or beta/i);
  });

  it('maps a missing profile', () => {
    expect(setAccessTierErrorMessage('profile not found')).toMatch(/no longer has a profile/i);
  });

  it('falls back to a retry sentence', () => {
    expect(setAccessTierErrorMessage('duplicate key')).toBe(
      'Could not change that member’s access. Please try again.',
    );
  });
});

describe('LaunchAccessClient', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
  });

  it('lists each member with her current launch tag', () => {
    render(<LaunchAccessClient members={MEMBERS} truncated={false} />);
    expect(screen.getByText('Maya')).toBeInTheDocument();
    expect(screen.getByText('@maya')).toBeInTheDocument();
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.getAllByText('Public').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(0);
  });

  it('opens the full app for a public member via set_access_tier', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(<LaunchAccessClient members={[MEMBERS[0]]} truncated={false} />);
    fireEvent.click(screen.getByRole('button', { name: /open full app for maya/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_access_tier', {
        p_user_id: 'u1',
        p_tier: 'beta',
      });
    });
  });

  it('returns a beta member to the limited launch', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(<LaunchAccessClient members={[MEMBERS[1]]} truncated={false} />);
    fireEvent.click(screen.getByRole('button', { name: /limit ari to archive and official chat/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_access_tier', {
        p_user_id: 'u2',
        p_tier: 'public',
      });
    });
  });

  it('does not call the RPC when the row is already that tier', () => {
    render(<LaunchAccessClient members={[MEMBERS[0]]} truncated={false} />);
    expect(screen.queryByRole('button', { name: /limit maya/i })).not.toBeInTheDocument();
  });

  it('filters the roster by name', () => {
    render(<LaunchAccessClient members={MEMBERS} truncated={false} />);
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ari' } });
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
  });

  it('asks the server for a name that may sit past the first 500', () => {
    render(<LaunchAccessClient members={MEMBERS} truncated={false} />);
    fireEvent.change(screen.getByLabelText(/search members/i), { target: { value: 'ari' } });
    fireEvent.keyDown(screen.getByLabelText(/search members/i), { key: 'Enter' });
    expect(mockReplace).toHaveBeenCalledWith('/staff/launch?q=ari');
  });

  it('shows an honest empty state', () => {
    render(<LaunchAccessClient members={[]} truncated={false} />);
    expect(screen.getByText(/nobody to tag/i)).toBeInTheDocument();
  });
});
