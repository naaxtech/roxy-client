import { Analytics } from '../../lib/analytics';

/**
 * The Supporter money path (spec 2026-10-26 §1 › Analytics): viewed → started
 * → completed / failed, plus restored. Five names, and what each may carry:
 * where she came from, which plan, which error code. Never her id, a price
 * string, or anything the store said in words — the conversion question
 * ("which perk sells it?") needs none of that.
 */

const mockPh = jest.fn();
const mockLogEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/posthog', () => ({
  posthog: { capture: (...a: unknown[]) => mockPh(...a) },
}));
jest.mock('@react-native-firebase/analytics', () => () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
  logScreenView: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => { mockPh.mockClear(); mockLogEvent.mockClear(); });

describe('Supporter analytics', () => {
  it('names the five money-path events exactly as the spec does, in both vendors', () => {
    Analytics.supporterPaywallViewed('you');
    Analytics.supporterPurchaseStarted('yearly');
    Analytics.supporterPurchaseCompleted('yearly');
    Analytics.supporterPurchaseFailed('STORE_PROBLEM_ERROR');
    Analytics.supporterRestored();
    const names = [
      'supporter_paywall_viewed',
      'supporter_purchase_started',
      'supporter_purchase_completed',
      'supporter_purchase_failed',
      'supporter_restored',
    ];
    expect(mockPh.mock.calls.map((c) => c[0])).toEqual(names);
    expect(mockLogEvent.mock.calls.map((c) => c[0])).toEqual(names);
  });

  it('carries only source, plan or code', () => {
    Analytics.supporterPaywallViewed('chapters');
    Analytics.supporterPurchaseStarted('monthly');
    Analytics.supporterPurchaseCompleted('monthly');
    Analytics.supporterPurchaseFailed('NETWORK_ERROR');
    Analytics.supporterRestored();
    expect(mockPh.mock.calls.map((c) => c[1])).toEqual([
      { source: 'chapters' },
      { plan: 'monthly' },
      { plan: 'monthly' },
      { code: 'NETWORK_ERROR' },
      undefined,
    ]);
  });
});
