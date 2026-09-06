import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  TeamClient,
  setCommunityOwnerErrorMessage,
  setStaffRoleErrorMessage,
  type TeamMember,
} from '@/app/(dashboard)/staff/team/TeamClient';

const mockRpc = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({ rpc: (...args: unknown[]) => mockRpc(...args) })),
}));
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ refresh: jest.fn(), push: mockPush, replace: mockReplace })),
}));

const CORE: TeamMember = {
  id: 'c1',
  displayName: 'Official',
  username: 'official',
  staffRole: 'core',
  createdLabel: '1 Sep 2026',
};

const STAFF: TeamMember = {
  id: 's1',
  displayName: 'Pat',
  username: 'pat',
  staffRole: 'staff',
  createdLabel: '2 Sep 2026',
};

const MEMBER: TeamMember = {
  id: 'm1',
  displayName: 'Maya',
  username: 'maya',
  staffRole: null,
  isCommunityOwner: false,
  vettingStatus: 'approved',
  createdLabel: '3 Sep 2026',
};

const OWNER: TeamMember = {
  id: 'o1',
  displayName: 'Oak',
  username: 'oak',
  staffRole: null,
  isCommunityOwner: true,
  vettingStatus: 'approved',
  createdLabel: '4 Sep 2026',
};

describe('setStaffRoleErrorMessage', () => {
  it('maps not-authorised without leaking a Postgres code', () => {
    const msg = setStaffRoleErrorMessage('not authorised to set staff role');
    expect(msg).not.toMatch(/42501/);
    expect(msg.toLowerCase()).toContain('not authorised');
  });

  it('maps a core-protection refusal', () => {
    expect(setStaffRoleErrorMessage('cannot change a core account')).toMatch(/cannot be changed/i);
  });

  it('falls back to a retry sentence', () => {
    expect(setStaffRoleErrorMessage('duplicate key')).toBe(
      'Could not change that member’s staff role. Please try again.',
    );
  });
});

describe('TeamClient', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
  });

  it('lists core and staff, and will not offer a change on core', () => {
    render(<TeamClient members={[CORE, STAFF]} roster={[]} truncated={false} />);
    expect(screen.getByText('Official')).toBeInTheDocument();
    expect(screen.getByText('Pat')).toBeInTheDocument();
    expect(screen.getByText('Roxy core')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove staff from official/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove staff from pat/i })).toBeInTheDocument();
  });

  it('makes a searched member staff via set_staff_role', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(
      <TeamClient
        members={[CORE]}
        roster={[MEMBER]}
        truncated={false}
        initialQuery="maya"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /make maya staff/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_staff_role', {
        p_user_id: 'm1',
        p_role: 'staff',
      });
    });
  });

  it('asks the server for a name that may sit past the first 500', () => {
    render(<TeamClient members={[CORE]} roster={[]} truncated={false} />);
    fireEvent.change(screen.getByLabelText(/find a member to make staff or a community owner/i), {
      target: { value: 'maya' },
    });
    fireEvent.keyDown(screen.getByLabelText(/find a member to make staff or a community owner/i), {
      key: 'Enter',
    });
    expect(mockReplace).toHaveBeenCalledWith('/staff/team?q=maya');
  });
});

describe('setCommunityOwnerErrorMessage', () => {
  it('refuses pending and staff without leaking a Postgres code', () => {
    expect(setCommunityOwnerErrorMessage('only approved members can be community owners'))
      .toMatch(/approved member/i);
    expect(setCommunityOwnerErrorMessage('cannot tag staff')).toMatch(/staff/i);
    expect(setCommunityOwnerErrorMessage('cannot tag a core account')).toMatch(/core/i);
    expect(setCommunityOwnerErrorMessage('not authorised to set community owner')).not.toMatch(/42501/);
  });
});

describe('TeamClient community owners', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
  });

  it('tags a searched approved member via set_community_owner', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(
      <TeamClient
        members={[CORE]}
        roster={[MEMBER]}
        truncated={false}
        initialQuery="maya"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /make maya a community owner/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_community_owner', {
        p_user_id: 'm1',
        p_owner: true,
      });
    });
  });

  it('lists tagged owners and can remove the tag', async () => {
    mockRpc.mockResolvedValue({ error: null });
    render(<TeamClient members={[CORE, OWNER]} roster={[]} truncated={false} />);
    expect(screen.getByText('Oak')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove community owner from oak/i }));
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_community_owner', {
        p_user_id: 'o1',
        p_owner: false,
      });
    });
  });
});
