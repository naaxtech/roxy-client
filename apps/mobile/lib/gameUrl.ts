/**
 * A community game is opened inside a WebView with the Roxy SDK injected
 * (lib/roxyGameSdk.ts), so its URL is executable content running next to a bridge
 * that knows the viewer's user id. Only an absolute https URL is accepted:
 * `http:` would carry that over cleartext, and `javascript:` / `file:` / `data:`
 * URLs would run against the bridge itself.
 *
 * `games.url` is null for Roxy's own in-app games (migration 016_rooms_games.sql),
 * which are launched by route, not by URL — those return false here on purpose.
 */
export function isPlayableGameUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(url.trim());
}
