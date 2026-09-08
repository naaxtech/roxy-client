import { renderHook, act } from '@testing-library/react-native';
import { useAccess } from '../../hooks/useAccess';
import { useProfileStore } from '../../store/profileStore';
import { useViewAsStore } from '../../store/viewAsStore';

function setProfile(partial: Record<string, unknown>) {
  useProfileStore.setState({ profile: partial as never });
}

beforeEach(() => {
  useProfileStore.setState({ profile: null });
  useViewAsStore.setState({ preview: null });
});

describe('useAccess', () => {
  it('keeps a beta member on the full app even without a staff role', () => {
    setProfile({ access_tier: 'beta', vetting_status: 'approved' });
    const { result } = renderHook(() => useAccess());
    expect(result.current.kind).toBe('member');
    expect(result.current.isBeta).toBe(true);
    expect(result.current.can('discover')).toBe(true);
  });

  it('holds a public member to Archive and Official', () => {
    setProfile({ access_tier: 'public', vetting_status: 'approved' });
    const { result } = renderHook(() => useAccess());
    expect(result.current.can('archive')).toBe(true);
    expect(result.current.can('officialChat')).toBe(true);
    expect(result.current.can('communities')).toBe(false);
    expect(result.current.canCommunity('roxy-official')).toBe(true);
    expect(result.current.canCommunity('wlw-london')).toBe(false);
  });

  it('lets a tagged community owner into community chat, not DMs', () => {
    setProfile({
      access_tier: 'public',
      vetting_status: 'approved',
      is_community_owner: true,
    });
    const { result } = renderHook(() => useAccess());
    expect(result.current.kind).toBe('communityOwner');
    expect(result.current.can('communities')).toBe(true);
    expect(result.current.canCommunity('wlw-london')).toBe(true);
    expect(result.current.can('dms')).toBe(false);
  });

  it('lets core preview a member without writing the HQ row', () => {
    setProfile({
      staff_role: 'core',
      is_staff: true,
      access_tier: 'beta',
      vetting_status: 'approved',
    });
    const { result } = renderHook(() => useAccess());
    expect(result.current.isCore).toBe(true);
    expect(result.current.can('discover')).toBe(true);

    act(() => useViewAsStore.getState().setPreview('member'));
    expect(result.current.kind).toBe('member');
    expect(result.current.isPreviewing).toBe(true);
    expect(result.current.isCore).toBe(true);
    expect(result.current.can('discover')).toBe(false);
    expect(result.current.can('officialChat')).toBe(true);
  });

  it('ignores preview unless the signed-in account is core', () => {
    setProfile({ staff_role: 'staff', is_staff: true, vetting_status: 'approved' });
    act(() => useViewAsStore.getState().setPreview('pending'));
    const { result } = renderHook(() => useAccess());
    expect(result.current.kind).toBe('staff');
    expect(result.current.isPreviewing).toBe(false);
    expect(result.current.can('dms')).toBe(true);
  });
});
