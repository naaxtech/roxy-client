import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Bottom-bar marks from the Claude Design prototype (`Roxy App.dc.html`).
 *
 * They are not Ionicons. Feed is the five-petal brand rosette; Discover is a
 * search glass; Messages is a tailed bubble; You is a person. Active state
 * is colour, not a filled swap — the prototype never changes the stroke.
 *
 * Paths are copied from the HTML, viewBox 0 0 24 24, 23dp.
 */

export type NavIconName = 'feed' | 'discover' | 'messages' | 'you' | 'archive';

const SIZE = 23;

export function NavIcon({
  name, color, size = SIZE, testID,
}: {
  name: NavIconName;
  color: string;
  size?: number;
  testID?: string;
}) {
  switch (name) {
    case 'feed':
      return <FeedMark color={color} size={size} testID={testID} />;
    case 'discover':
      return <DiscoverMark color={color} size={size} testID={testID} />;
    case 'messages':
      return <MessagesMark color={color} size={size} testID={testID} />;
    case 'you':
      return <YouMark color={color} size={size} testID={testID} />;
    case 'archive':
      return <ArchiveMark color={color} size={size} testID={testID} />;
  }
}

function FeedMark({ color, size, testID }: { color: string; size: number; testID?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Circle cx="12" cy="5.6" r="3" stroke={color} strokeWidth={1.8} />
      <Circle cx="18.1" cy="10" r="3" stroke={color} strokeWidth={1.8} />
      <Circle cx="15.8" cy="17.2" r="3" stroke={color} strokeWidth={1.8} />
      <Circle cx="8.2" cy="17.2" r="3" stroke={color} strokeWidth={1.8} />
      <Circle cx="5.9" cy="10" r="3" stroke={color} strokeWidth={1.8} />
      <Circle cx="12" cy="11.6" r="1.3" fill={color} stroke="none" />
    </Svg>
  );
}

function DiscoverMark({ color, size, testID }: { color: string; size: number; testID?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={1.9} />
      <Path d="M16.6 16.6 21 21" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

function MessagesMark({ color, size, testID }: { color: string; size: number; testID?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Path
        d="M4 5.6h16v10.8h-8.2L7 20.4v-4H4Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function YouMark({ color, size, testID }: { color: string; size: number; testID?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Circle cx="12" cy="8" r="3.8" stroke={color} strokeWidth={1.8} />
      <Path
        d="M4.8 20c1.4-3.3 4-4.9 7.2-4.9s5.8 1.6 7.2 4.9"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Same stroke language as the prototype marks. Public launch only. */
function ArchiveMark({ color, size, testID }: { color: string; size: number; testID?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" testID={testID}>
      <Path
        d="M5 4.8h14v3.2H5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M6.4 8v11.2h11.2V8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M10 12.2h4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
