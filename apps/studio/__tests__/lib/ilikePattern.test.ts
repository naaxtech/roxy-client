import { ilikePattern, sanitizeForPattern } from '@/lib/ilikePattern';

describe('ilikePattern', () => {
  it('wraps a clean term so PostgREST can search inside the name', () => {
    expect(ilikePattern('rox')).toBe('%rox%');
  });

  it('drops filter grammar and escapes wildcards', () => {
    expect(sanitizeForPattern('bakery,cafe_100%')).toBe('bakerycafe\\_100\\%');
    expect(ilikePattern('()')).toBeNull();
  });
});
