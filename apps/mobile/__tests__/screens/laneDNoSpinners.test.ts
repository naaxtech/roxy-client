import fs from 'fs';
import path from 'path';

/**
 * F11 ratchet for lane D screens converted in Wave 3: none of these may draw
 * an ActivityIndicator again. Waits use skeletons at final geometry, the
 * faceless O (RoxyLoading, 200/400 ms) or BusySwap on controls. Behaviour is
 * covered per screen where a suite exists; this pins the rest.
 */
const ROOT = path.join(__dirname, '..', '..');
const FILES = [
  'app/(auth)/application.tsx',
  'app/(auth)/pending.tsx',
  'app/(auth)/reset-password.tsx',
  'app/(auth)/welcome.tsx',
  'app/tickets.tsx',
  'app/badges.tsx',
  'app/qotd/[id].tsx',
  'app/product/[id].tsx',
  'app/support.tsx',
  'app/(tabs)/you/blocked.tsx',
  'app/(tabs)/you/edit.tsx',
  'app/(tabs)/you/feedback.tsx',
  'app/(tabs)/you/delete-account.tsx',
  'app/(tabs)/you/index.tsx',
  'app/(tabs)/you/settings.tsx',
  'app/(tabs)/you/notification-settings.tsx',
  'app/(tabs)/messages/new.tsx',
  'app/chat/[id].tsx',
  'app/chat/info/[id].tsx',
  'app/(tabs)/discover/community/channels/[communityId].tsx',
  'components/chat/ActionTray.tsx',
  'components/chat/GifPicker.tsx',
  'components/messages/OfficialChatInbox.tsx',
  'components/profile/AvatarPickerSheet.tsx',
  'components/profile/InlineReplies.tsx',
  'components/profile/ProfileFavorites.tsx',
  'components/profile/ProfilePhotoGrid.tsx',
  'components/profile/ProfilePostsGrid.tsx',
  'components/profile/ProfileThoughts.tsx',
  'app/business/[id].tsx',
  'app/sister-button.tsx',
  'app/speed-dating/index.tsx',
  'app/speed-dating/result.tsx',
  'app/speed-dating/waiting-room.tsx',
  'app/community-room-session.tsx',
  'app/community/create-event.tsx',
  'components/build/CheckoutSheet.tsx',
  'components/build/FeatureVoteCard.tsx',
  'components/donations/DonateModal.tsx',
  'components/grow/AnswerSheet.tsx',
  'components/grow/MiniWinsCard.tsx',
  'components/grow/QuestionOfTheDayCard.tsx',
];

/** Lists that offer pull-to-refresh do it through C0's RoxyRefresh (web pull + tinted native control). */
const REFRESH = [
  'components/messages/MessagesInbox.tsx',
  'components/profile/ProfileShell.tsx',
  'app/tickets.tsx',
  'app/qotd/[id].tsx',
];

it.each(REFRESH)('%s pulls to refresh through RoxyRefresh, not a bare RefreshControl', (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  expect(src).toMatch(/<RoxyRefresh\b/);
  expect(src).not.toMatch(/<RefreshControl\b/);
});

it.each(FILES)('%s draws no ActivityIndicator (F11)', (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  expect(src).not.toMatch(/<ActivityIndicator\b/);
});
