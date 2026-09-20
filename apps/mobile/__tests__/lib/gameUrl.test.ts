import { isPlayableGameUrl } from '../../lib/gameUrl';

describe('isPlayableGameUrl', () => {
  it('accepts an absolute https game URL', () => {
    expect(isPlayableGameUrl('https://games.roxy.app/trivia')).toBe(true);
    expect(isPlayableGameUrl('https://trivia.app')).toBe(true);
    expect(isPlayableGameUrl('  https://trivia.app/play?room=7  ')).toBe(true);
  });

  it('rejects a null url — that is a native Roxy game, launched by route', () => {
    expect(isPlayableGameUrl(null)).toBe(false);
    expect(isPlayableGameUrl(undefined)).toBe(false);
    expect(isPlayableGameUrl('')).toBe(false);
  });

  it('rejects anything that is not https', () => {
    // The URL is loaded into a WebView with the Roxy SDK bridge injected.
    expect(isPlayableGameUrl('http://trivia.app')).toBe(false);
    expect(isPlayableGameUrl('javascript:alert(1)')).toBe(false);
    expect(isPlayableGameUrl('file:///etc/passwd')).toBe(false);
    expect(isPlayableGameUrl('data:text/html,<script>1</script>')).toBe(false);
  });

  it('rejects an app route — the old code pushed these into expo-router and dead-ended', () => {
    expect(isPlayableGameUrl('/speed-dating')).toBe(false);
    expect(isPlayableGameUrl('(tabs)/discover')).toBe(false);
  });
});
