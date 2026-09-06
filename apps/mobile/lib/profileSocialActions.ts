/**
 * Which header buttons a profile shows.
 *
 * Claude Design (`Roxy App.dc.html` 499–509): a person is Message + Follow;
 * a community is # Channels + Join. Official is a person with a grant, so
 * she gets Follow (posts) and Join (chat). Friends stay request-first for DMs.
 */

export type FriendshipState = 'none' | 'sent' | 'received' | 'friends';

export type SocialRole =
  | 'follow'
  | 'unfollow'
  | 'join'
  | 'joined'
  | 'channels'
  | 'message'
  | 'add-friend'
  | 'accept'
  | 'requested';

export type SocialButton = {
  role: SocialRole;
  label: string;
  testID: string;
  pressable: boolean;
  tone: 'primary' | 'secondary';
};

export type ProfileSocialActions = {
  primary: SocialButton;
  secondary?: SocialButton;
  tertiary?: SocialButton;
};

function followButton(following: boolean): SocialButton {
  return following
    ? { role: 'unfollow', label: 'Following', testID: 'profile-follow', pressable: true, tone: 'secondary' }
    : { role: 'follow', label: 'Follow', testID: 'profile-follow', pressable: true, tone: 'secondary' };
}

function friendPrimary(friendship: FriendshipState): SocialButton {
  if (friendship === 'received') {
    return { role: 'accept', label: 'Accept 💜', testID: 'profile-friend', pressable: true, tone: 'primary' };
  }
  if (friendship === 'sent') {
    return { role: 'requested', label: 'Requested', testID: 'profile-friend', pressable: false, tone: 'primary' };
  }
  if (friendship === 'friends') {
    return { role: 'message', label: 'Message', testID: 'profile-message', pressable: true, tone: 'primary' };
  }
  return { role: 'add-friend', label: 'Add friend', testID: 'profile-friend', pressable: true, tone: 'primary' };
}

export function profileSocialActions(input: {
  official: boolean;
  following: boolean;
  joined: boolean;
  friendship: FriendshipState;
}): ProfileSocialActions {
  const follow = followButton(input.following);

  if (!input.official) {
    return { primary: friendPrimary(input.friendship), secondary: follow };
  }

  if (input.joined) {
    return {
      primary: { role: 'joined', label: 'Joined', testID: 'profile-join', pressable: false, tone: 'primary' },
      secondary: {
        role: 'channels',
        label: '# Channels',
        testID: 'profile-channels',
        pressable: true,
        tone: 'secondary',
      },
      tertiary: follow,
    };
  }

  return {
    primary: { role: 'join', label: 'Join', testID: 'profile-join', pressable: true, tone: 'primary' },
    secondary: follow,
    tertiary: friendPrimary(input.friendship),
  };
}
