jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server');

describe('updateNotificationPrefs', () => {
  it('merges prefs into profiles.notification_preferences', async () => {
    const mockEq = jest.fn().mockResolvedValue({ error: null });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: { sub: 'user-1' } } }) },
      from: jest.fn(() => ({ update: mockUpdate })),
    });
    const { updateNotificationPrefs } = await import('@/app/(dashboard)/settings/account-actions');
    await updateNotificationPrefs({ studio_orders: true, studio_community: false, studio_news: true });
    expect(mockUpdate).toHaveBeenCalledWith({
      notification_preferences: { studio_orders: true, studio_community: false, studio_news: true },
    });
  });

  it('throws if not authenticated', async () => {
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: null } }) },
    });
    const { updateNotificationPrefs } = await import('@/app/(dashboard)/settings/account-actions');
    await expect(updateNotificationPrefs({ studio_orders: true, studio_community: true, studio_news: true }))
      .rejects.toThrow('Not authenticated');
  });
});
