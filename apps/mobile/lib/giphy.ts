/**
 * GIPHY wiring for the chat GIF picker.
 *
 * The key is inlined at build time from `EXPO_PUBLIC_GIPHY_API_KEY`, so it must be
 * present in `apps/mobile/.env` for local runs AND in each `eas.json` build profile
 * (`build.development.env`, `build.preview.env`, `build.production.env`) for shipped
 * builds — an EXPO_PUBLIC_ var that is missing at bundle time is baked in as empty,
 * not read later at runtime. It is absent from all four places today, which is why
 * `isGiphyConfigured()` returns false in every current build.
 *
 * Reading it here (rather than in the component) keeps the picker testable: a test
 * can mock this module for both the configured and unconfigured paths.
 */
const GIPHY_API_KEY: string = process.env.EXPO_PUBLIC_GIPHY_API_KEY ?? '';
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

/** False when no key was bundled — the picker must not fire requests that can only 403. */
export function isGiphyConfigured(): boolean {
  return GIPHY_API_KEY.trim().length > 0;
}

/** Trending when the query is blank, search otherwise. G-rated only — this is a community app. */
export function giphyEndpoint(query: string): string {
  const trimmed = query.trim();
  const key = encodeURIComponent(GIPHY_API_KEY);
  return trimmed
    ? `${GIPHY_BASE}/search?api_key=${key}&q=${encodeURIComponent(trimmed)}&limit=20&rating=g`
    : `${GIPHY_BASE}/trending?api_key=${key}&limit=20&rating=g`;
}
