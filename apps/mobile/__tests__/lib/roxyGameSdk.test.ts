import { buildRoxySDK } from '../../lib/roxyGameSdk';

describe('buildRoxySDK', () => {
  it('injects user id and displayName', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('"u1"');
    expect(sdk).toContain('"Maya"');
  });

  it('contains roxy:close postMessage', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('roxy:close');
  });

  it('contains roxy:shareScore postMessage', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk).toContain('roxy:shareScore');
  });

  it('ends with true for injectedJavaScript requirement', () => {
    const sdk = buildRoxySDK({ id: 'u1', displayName: 'Maya' });
    expect(sdk.trim().endsWith('true;')).toBe(true);
  });
});
