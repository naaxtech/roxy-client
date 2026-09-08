import { renderHook } from '@testing-library/react-native';
import { useMembership } from '../../hooks/useMembership';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import type { Profile } from '../../types';
import type { User } from '@supabase/supabase-js';

function setAuth(user: User | null) {
  useAuthStore.setState({ user, session: null, loading: false });
}

function setProfile(profile: Partial<Profile> | null) {
  useProfileStore.setState({ profile: profile as Profile | null });
}

beforeEach(() => {
  setAuth(null);
  setProfile(null);
});

describe('useMembership — signed out', () => {
  it('cannot browse, review, or edit with no session', () => {
    const { result } = renderHook(() => useMembership());
    expect(result.current.canBrowseArchive).toBe(false);
    expect(result.current.canReview).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });
});

describe('useMembership — signed in, profile not yet loaded', () => {
  it('fails closed: can browse (authenticated) but cannot write until the real status is known', () => {
    setAuth({ id: 'u1' } as User);
    setProfile(null);

    const { result } = renderHook(() => useMembership());
    expect(result.current.canBrowseArchive).toBe(true);
    expect(result.current.canReview).toBe(false);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.status).toBe('pending');
  });
});

describe('useMembership — vetting_status drives review/edit access', () => {
  it('pending: can browse (the whole point of the Archive per 079) but cannot write', () => {
    setAuth({ id: 'u1' } as User);
    setProfile({ id: 'u1', vetting_status: 'pending' });

    const { result } = renderHook(() => useMembership());
    expect(result.current.status).toBe('pending');
    expect(result.current.canBrowseArchive).toBe(true);
    expect(result.current.canReview).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });

  it("unvetted (grandfathered pre-gate population) can review and edit — excluding it would lock out every pre-gate account, exactly what 072's comment warns about", () => {
    setAuth({ id: 'u1' } as User);
    setProfile({ id: 'u1', vetting_status: 'unvetted' });

    const { result } = renderHook(() => useMembership());
    expect(result.current.status).toBe('unvetted');
    expect(result.current.canBrowseArchive).toBe(true);
    expect(result.current.canReview).toBe(true);
    expect(result.current.canEdit).toBe(true);
  });

  it('approved can review and edit', () => {
    setAuth({ id: 'u1' } as User);
    setProfile({ id: 'u1', vetting_status: 'approved' });

    const { result } = renderHook(() => useMembership());
    expect(result.current.status).toBe('approved');
    expect(result.current.canBrowseArchive).toBe(true);
    expect(result.current.canReview).toBe(true);
    expect(result.current.canEdit).toBe(true);
  });

  it('rejected can still browse — RLS draws no line on archive_entries SELECT, and 079 is exactly the postmortem about locking a member out with no explaining screen; but cannot review or edit', () => {
    setAuth({ id: 'u1' } as User);
    setProfile({ id: 'u1', vetting_status: 'rejected' });

    const { result } = renderHook(() => useMembership());
    expect(result.current.status).toBe('rejected');
    expect(result.current.canBrowseArchive).toBe(true);
    expect(result.current.canReview).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });
});
