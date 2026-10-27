import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { Rail } from '../discover/Rail';
import { Analytics } from '../../lib/analytics';
import { NearbyPrompt } from './NearbyPrompt';
import { NearbyRows } from './NearbyRows';
import { useNearbyOrigin } from './useNearbyOrigin';
import { useNearbyResults } from './useNearbyResults';

/** Rows on Discover before "See all", like Communities for you. */
export const NEARBY_RAIL_ROWS = 3;
const TITLE = 'Near you';
const noop = () => undefined;

/**
 * Discover's "Near you" rail (spec › Client), on Discover's own `Rail`.
 *
 *  - Nothing to look from yet: the prompt card (Use my location / Choose a
 *    city). After a refusal: Choose a city only, and the rail never asks again.
 *  - Locating or loading: the shared skeleton rows at the rows' geometry.
 *  - Results: three `CommunityRow`s with a distance band, and "See all" into
 *    the communities browser in nearby mode (`/communities?near=1`).
 *  - Empty and error: one sentence each, with what to do next.
 *
 * Counted once per visit (`nearby_rail_viewed`) by mode only.
 */
export function NearbyRail() {
  const router = useRouter();
  const n = useNearbyOrigin();
  const results = useNearbyResults(NEARBY_RAIL_ROWS);

  const mode = n.origin ? n.origin.kind : n.denied ? 'denied' : 'prompt';
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current || !n.userId || n.loadedFor !== n.userId || n.locating) return;
    viewed.current = true;
    Analytics.nearbyRailViewed(mode);
  }, [n.userId, n.loadedFor, n.locating, mode]);

  if (!n.origin && !n.locating) {
    return (
      <>
        <Rail title={TITLE} layout="list" status="ready" count={1} emptyBody="" onRetry={noop} testID="nearby-rail">
          <NearbyPrompt
            denied={n.denied}
            problem={n.problem}
            onUseLocation={n.locateMe}
            onChooseCity={n.openCityPicker}
          />
        </Rail>
        {n.cityPicker}
      </>
    );
  }

  return (
    <>
      <Rail
        title={TITLE}
        layout="list"
        status={n.locating ? 'loading' : results.status}
        count={results.rows.length}
        emptyBody="No communities near you yet. Tap See all to look farther or change the filters."
        errorBody="Communities near you didn’t load. Check your connection and try again."
        onRetry={results.reload}
        linkLabel="See all"
        onLinkPress={() => router.push('/communities?near=1' as never)}
        skeleton={{ kind: 'row', count: NEARBY_RAIL_ROWS }}
        testID="nearby-rail"
      >
        <NearbyRows rows={results.rows} />
      </Rail>
      {n.cityPicker}
    </>
  );
}
