import { View, StyleSheet } from 'react-native';
import { ReelsFeed } from '../../../components/feed/ReelsFeed';
import { THEMES } from '../../../lib/theme';

/**
 * The Feed tab.
 *
 * `ReelsFeed` sizes its pages off the box it is given, so it must sit inside a
 * `flex: 1` parent and never beside one — as a sibling it measured against the
 * window, every page came out taller than the visible area, and no video ever
 * became "viewable" enough to play. That is a fixed bug, not a style choice.
 *
 * The ground is `THEMES.dark.background` rather than the active theme: a
 * full-bleed media pager is a cinema, and letterboxing a portrait video against
 * a pale surface reads as a rendering fault even in light mode. The prototype
 * does the same.
 *
 * Segments (For You / Following / Communities), the Now rail and the streak chip
 * land on top of this in phase 1 of the redesign; the pager underneath is
 * already the one the app ships.
 */
export default function FeedScreen() {
  return (
    <View style={styles.stage} testID="feed-screen">
      <ReelsFeed scope="announcements" />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: THEMES.dark.background },
});
