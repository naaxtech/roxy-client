/**
 * The feel gate's allowlist: the spec's TARGET exceptions, each with a reason
 * (polish/motion-spec.md §2 F2/F5/F7/F11/F12/F13, §3.3; decisions 2026-10-23 P3).
 * Everything not listed here has a target of 0. Changing this file is lane E's call: a lane
 * that needs an entry asks for it with the reason.
 */
import { allowlistFromSites, mergeAllowlists } from './feelGate';
import type { Allowlist, HapticSite } from './feelGate';

/** Non-haptic exceptions, triaged by hand on main 50b1f5d. */
export const STATIC_ALLOWLIST: Allowlist = {
  F2_raw_pressable_no_feedback: {
    'components/archive/ArchiveActionsSheet.tsx': {
      max: 1,
      reason: 'scrim backdrop (s.scrim, closes the sheet): a tap on the dimmed backdrop needs no press state (§2 F2)',
    },
    'components/channels/ChannelMessageActions.tsx': {
      max: 2,
      reason: 'scrim backdrop (s.scrim) + the sheet surface tap-swallower `onPress={() => {}}` (not a control) (§2 F2)',
    },
    'components/feed/FirstPostCelebration.tsx': {
      max: 1,
      reason: 'scrim backdrop `first-post-scrim` (§2 F2)',
    },
    'components/feedback/Sheet.tsx': {
      max: 1,
      reason: 'scrim backdrop `<id>-scrim-press` (closes the sheet; the scrim itself fades, §2 F5): a tap on the dimmed backdrop needs no press state (§2 F2). Added at the Wave 3 merge: C0 Sheet postdates this baseline',
    },
    'components/reactions/ReactionPicker.tsx': {
      max: 1,
      reason: 'dim backdrop `reaction-picker-dismiss` (§2 F2)',
    },
  },
  F5_modal_animationType_slide: {
    'components/dev/DevPanel.tsx': { max: 1, reason: 'developer tool, exempt (§2 F5 "DevPanel exempt")' },
  },
};

const R = 'components/reactions/';

/**
 * The §3.3 haptic map placed in the code: every haptic call must belong to one of these sites
 * (kind + file), and every `required` site must exist once its owner lands it.
 * Candidate files list every file where §4.2's owner may reasonably put the call.
 */
export const HAPTIC_SITES: HapticSite[] = [
  // selection — tab change; chip, segment, theme or radio choice
  { id: 'tab-change', kind: 'selection', event: 'tab change', files: ['components/nav/FloatingTabBar.tsx'], max: 1, required: true, lane: 'A' },
  { id: 'feed-segment', kind: 'selection', event: 'Feed segment choice (M028-030)', files: ['app/(tabs)/feed/index.tsx', 'components/feed/FeedSegments.tsx'], max: 1, required: true, lane: 'A/B' },
  { id: 'discover-chip', kind: 'selection', event: 'chip choice: Discover, events, economy, search scopes (FilterChips, M062/M069/M070/M073)', files: ['components/discover/FilterChips.tsx'], max: 1, required: true, lane: 'B' },
  { id: 'archive-chip', kind: 'selection', event: 'Archive chip choice (M152)', files: ['app/archive/index.tsx'], max: 1, required: true, lane: 'B' },
  { id: 'archive-vote', kind: 'selection', event: 'Archive vote 1-5 (M154, a radio choice)', files: ['components/archive/VoteCard.tsx'], max: 1, required: true, lane: 'B' },
  { id: 'interest-card', kind: 'selection', event: 'interest card chip (M036)', files: ['components/feed/FeedInterestCard.tsx'], max: 1, required: true, lane: 'B' },
  { id: 'interests', kind: 'selection', event: 'onboarding interests chip (M013)', files: ['app/(auth)/onboarding/step2-interests.tsx'], max: 1, required: true, lane: 'D' },
  { id: 'theme', kind: 'selection', event: 'theme segment (M023)', files: ['app/(tabs)/you/settings.tsx'], max: 1, required: true, lane: 'D' },
  { id: 'requests-segment', kind: 'selection', event: 'Requests sheet segment', files: ['components/messages/RequestsSheet.tsx'], max: 1, required: true, lane: 'D' },
  // selection — each emoji passed in the picker; long-press that opens a menu or picker (P3)
  { id: 'picker-pass', kind: 'selection', event: 'each emoji passed in the reaction picker', files: [`${R}useReactionPicker.ts`], max: 1, required: true, lane: 'C' },
  { id: 'picker-open', kind: 'selection', event: 'long-press opens the reaction picker (P3)', files: [`${R}useReactionPicker.ts`, `${R}ReactionButton.tsx`], max: 1, required: true, lane: 'C' },
  { id: 'dm-long-press', kind: 'selection', event: 'long-press opens the DM message menu (P3)', files: ['components/chat/MessageRow.tsx'], max: 1, required: true, lane: 'D' },
  { id: 'channel-long-press', kind: 'selection', event: 'long-press opens the channel message menu (P3)', files: ['components/channels/ChannelMessage.tsx', 'app/(tabs)/discover/community/channels/[communityId].tsx'], max: 1, required: true, lane: 'D' },
  { id: 'comment-long-press', kind: 'selection', event: 'long-press opens the comment actions (P3)', files: ['components/feed/CommentThread.tsx'], max: 1, required: true, lane: 'B' },
  // selection — swipe-to-reply threshold (P3)
  { id: 'dm-swipe-reply', kind: 'selection', event: 'swipe-to-reply threshold in a DM (P3)', files: ['components/chat/MessageRow.tsx'], max: 1, required: true, lane: 'D' },
  { id: 'channel-swipe-reply', kind: 'selection', event: 'swipe-to-reply threshold in a channel (P3)', files: ['components/channels/ChannelMessage.tsx'], max: 1, required: true, lane: 'D' },
  // selection — pull-to-refresh threshold (P3)
  { id: 'refresh-threshold', kind: 'selection', event: 'pull-to-refresh threshold (P3)', files: ['components/feedback/RoxyRefresh.tsx'], max: 1, required: true, lane: 'C0/C' },
  // light — committed reaction (§3.1 row 11: rail, double-tap, DM, channel, thoughts)
  { id: 'reaction-commit', kind: 'light', event: 'committed reaction (picker pick + tap)', files: [`${R}useReactionPicker.ts`], max: 2, required: true, lane: 'C' },
  { id: 'reaction-double-tap', kind: 'light', event: 'committed reaction (double-tap)', files: [`${R}DoubleTapReact.tsx`], max: 1, required: true, lane: 'C' },
  { id: 'reaction-double-tap-legacy', kind: 'light', event: 'committed reaction (legacy double-tap like)', files: ['components/feed/DoubleTapLike.tsx'], max: 1, required: false, lane: 'B' },
  { id: 'dm-reaction', kind: 'light', event: 'committed DM reaction (chip toggle, action sheet, emoji keyboard)', files: ['components/chat/MessageRow.tsx', 'components/chat/MessageActionSheet.tsx', 'app/chat/[id].tsx'], max: 1, required: false, lane: 'D' },
  { id: 'channel-reaction', kind: 'light', event: 'committed channel reaction', files: ['app/(tabs)/discover/community/channels/[communityId].tsx', 'components/channels/ChannelMessage.tsx'], max: 1, required: false, lane: 'D' },
  // light — FAB opens Roxy AI; switch toggled
  { id: 'fab-roxy-ai', kind: 'light', event: 'FAB opens Roxy AI', files: ['components/ui/RoxyCompanionButton.tsx'], max: 1, required: true, lane: 'C' },
  { id: 'switch', kind: 'light', event: 'switch toggled', files: ['components/ui/Switch.tsx'], max: 1, required: true, lane: 'C' },
  { id: 'switch-local', kind: 'light', event: 'switch toggled (SelfControls local SwitchRow, until it adopts ui/Switch)', files: ['components/profile/SelfControls.tsx'], max: 1, required: false, lane: 'D' },
  // medium — RSVP seal lands
  { id: 'rsvp-seal', kind: 'medium', event: 'RSVP seal lands', files: ['app/event/[id].tsx', 'components/events/GoingSeal.tsx'], max: 1, required: true, lane: 'D' },
  // success — "You're in"
  { id: 'youre-in', kind: 'success', event: '"You\'re in"', files: ['app/(auth)/welcome-in.tsx'], max: 1, required: true, lane: 'D' },
];

export const ALLOWLIST: Allowlist = mergeAllowlists(STATIC_ALLOWLIST, allowlistFromSites(HAPTIC_SITES));
