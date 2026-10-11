import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * ST-04: a staff queue whose query FAILED must say so — "None" / an empty
 * list there tells staff nothing is waiting when nobody knows. Each page is
 * rendered for real (async server component called as a function) against a
 * Supabase mock where the staff check passes and every other query errors.
 */

const mockFailure = { code: '57014', message: 'canceling statement due to statement timeout' };

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => {
    const chain = (table: string) => {
      const ok: Record<string, unknown> = {
        profiles: { is_staff: true, staff_role: 'core' },
        host_stripe_accounts: { stripe_account_id: 'acct_x', onboarding_complete: true },
      };
      const result =
        table in ok
          ? { data: ok[table], error: null }
          : { data: null, error: mockFailure };
      const proxy: Record<string, unknown> = {};
      const handler = () => proxy;
      for (const m of ['select', 'eq', 'is', 'not', 'in', 'order', 'limit', 'neq', 'gte', 'lte', 'or']) {
        proxy[m] = handler;
      }
      proxy.single = async () => result;
      proxy.maybeSingle = async () => result;
      proxy.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return proxy;
    };
    return {
      auth: {
        getClaims: async () => ({ data: { claims: { sub: 'u1' } } }),
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
      },
      from: (table: string) => chain(table),
      rpc: async () => ({ data: null, error: mockFailure }),
    };
  }),
}));
jest.mock('@/lib/staff-guard', () => ({
  requireStaffPage: jest.fn(async () => ({ userId: 'u1', isCore: true })),
  assertStaffAction: jest.fn(),
  assertUuid: (v: string) => v,
}));
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: jest.fn(() => ({ refresh: jest.fn(), push: jest.fn() })),
  usePathname: jest.fn(() => '/staff'),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
// The overview imports server actions (next/server) and an async card; the
// card has its own error state and tests (LaunchFunnel.test.tsx).
jest.mock('@/app/(dashboard)/staff/payout-actions', () => ({ setPayoutBlock: jest.fn(), releasePayout: jest.fn() }));
jest.mock('@/app/(dashboard)/staff/LaunchFunnelCard', () => ({ LaunchFunnelCard: () => null }));
jest.mock('@/lib/business', () => ({
  getOwnedBusiness: jest.fn(async () => ({ id: 'b1', name: 'Shop', stripe_account_id: null, can_sell: true })),
}));

type PageFn = () => Promise<React.ReactElement>;

const PAGES: [string, () => Promise<{ default: PageFn }>, RegExp][] = [
  ['staff/businesses', () => import('@/app/(dashboard)/staff/businesses/page'), /could not load/i],
  ['staff/products', () => import('@/app/(dashboard)/staff/products/page'), /could not load/i],
  ['staff/disputes', () => import('@/app/(dashboard)/staff/disputes/page'), /could not load/i],
  ['staff/reconciliation', () => import('@/app/(dashboard)/staff/reconciliation/page'), /could not load/i],
  ['staff/feature-requests', () => import('@/app/(dashboard)/staff/feature-requests/page'), /could not load/i],
  ['staff (overview)', () => import('@/app/(dashboard)/staff/page'), /could not load/i],
  ['payouts (host)', () => import('@/app/(dashboard)/payouts/page'), /could not load your paid events/i],
  ['seller-payouts (host)', () => import('@/app/(dashboard)/seller-payouts/page'), /could not load your payout history/i],
  ['products (host)', () => import('@/app/(dashboard)/products/page'), /could not load your products/i],
];

describe.each(PAGES)('%s when its query fails', (_name, load, expected) => {
  it('shows an error state, not an empty queue', async () => {
    const { default: Page } = await load();
    const el = await Page();
    render(el);
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((a) => expected.test(a.textContent ?? ''))).toBe(true);
    expect(screen.queryByText(/^None\.?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^No entries\.?$/)).not.toBeInTheDocument();
  });
});
