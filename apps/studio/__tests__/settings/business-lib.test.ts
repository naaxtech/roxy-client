import { getOwnedBusinessFull } from '@/lib/business';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

const { createClient } = jest.requireMock('@/lib/supabase/server');

describe('getOwnedBusinessFull', () => {
  it('returns null when no user', async () => {
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: null } }) },
    });
    expect(await getOwnedBusinessFull()).toBeNull();
  });

  it('returns full business data for authenticated user', async () => {
    const mockBusiness = {
      id: 'biz-1', name: 'Test Biz', description: 'Desc',
      category: 'Beauty & Wellness', location_city: 'NYC',
      website_url: 'https://test.com', instagram_handle: '@test',
      tiktok_handle: null, facebook_url: null,
      contact_email: null, phone: null,
      logo_url: null, is_verified: false, is_wlw_owned: true,
      business_rejection_reason: null,
      stripe_account_id: null, stripe_onboarded_at: null,
      can_sell: false, payout_schedule_set: false,
    };
    createClient.mockResolvedValue({
      auth: { getClaims: jest.fn().mockResolvedValue({ data: { claims: { sub: 'user-1' } } }) },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn().mockResolvedValue({ data: mockBusiness }),
          })),
        })),
      })),
    });
    const result = await getOwnedBusinessFull();
    expect(result?.name).toBe('Test Biz');
    expect(result?.tiktok_handle).toBeNull();
  });
});
