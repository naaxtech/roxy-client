import * as Linking from 'expo-linking';

/**
 * The payload for sharing an Archive entry.
 *
 * The feed's share sheet DELIBERATELY omits the author's name: it hands the
 * payload to an arbitrary app, and naming a member there is a disclosure about
 * a third party who never agreed to it (`components/feed/FeedCellChrome.tsx`).
 *
 * An Archive entry is the opposite case and the distinction is worth stating,
 * because the safe-looking move here is to copy that rule and ship a share that
 * says nothing. The subject is a FILM, not a member. `Carol` is a published
 * work; the title discloses nobody. What must not travel is the community's
 * verdict on it attached to any individual — so the payload carries the title
 * and the link, never a score, a reviewer, or a note.
 */
export interface ArchiveShare {
  message: string;
  url: string;
}

export function archiveSharePath(slug: string): string {
  return `/archive/${slug}`;
}

export function archiveShare(slug: string, title: string): ArchiveShare {
  // Android's share sheet reads `message` only, iOS prefers `url` — so the link
  // goes in both or half the platforms share nothing. Same rule as the feed.
  // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-linking/src/createURL.ts · expo-linking 6.3.1 · 2026-09-05
  const url = Linking.createURL(archiveSharePath(slug));
  return { message: `${title} — on the WLW Archive: ${url}`, url };
}
