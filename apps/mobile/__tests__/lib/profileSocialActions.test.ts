import { profileSocialActions } from '../../lib/profileSocialActions';

describe('profileSocialActions — a person', () => {
  it('is Follow plus the friend / Message row the prototype paints', () => {
    const none = profileSocialActions({
      official: false, following: false, joined: false, friendship: 'none',
    });
    expect(none.primary).toMatchObject({ role: 'add-friend', label: 'Add friend' });
    expect(none.secondary).toMatchObject({ role: 'follow', label: 'Follow', testID: 'profile-follow' });

    const friends = profileSocialActions({
      official: false, following: true, joined: false, friendship: 'friends',
    });
    expect(friends.primary).toMatchObject({ role: 'message', label: 'Message' });
    expect(friends.secondary).toMatchObject({ role: 'unfollow', label: 'Following' });
  });
});

describe('profileSocialActions — an official community account', () => {
  it('is Follow + Join before she is a member', () => {
    const actions = profileSocialActions({
      official: true, following: false, joined: false, friendship: 'none',
    });
    expect(actions.primary).toMatchObject({ role: 'join', label: 'Join', testID: 'profile-join' });
    expect(actions.secondary).toMatchObject({ role: 'follow', testID: 'profile-follow' });
    expect(actions.tertiary).toMatchObject({ role: 'add-friend' });
  });

  it('is Channels + Joined + Follow once she has joined', () => {
    const actions = profileSocialActions({
      official: true, following: true, joined: true, friendship: 'friends',
    });
    expect(actions.primary).toMatchObject({ role: 'joined', pressable: false });
    expect(actions.secondary).toMatchObject({ role: 'channels', label: '# Channels' });
    expect(actions.tertiary).toMatchObject({ role: 'unfollow', label: 'Following' });
  });
});
