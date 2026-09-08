import { Analytics } from '../../lib/analytics';

/**
 * The Thoughts funnel: opened → sent.
 *
 * The whole point of expanding replies in place was that pushing a screen cost
 * a woman her scroll position and her place in the thread. The drop-off between
 * opening a thread and actually saying something is the only way to find out
 * whether removing that navigation worked.
 *
 * These also pin what the events must NOT carry. Nothing here needs a post id,
 * an author or a word of what she wrote, and an event carries what the question
 * needs and no more — the same reasoning that took the entry slug out of
 * `archive_vote_cast`.
 */

const mockPh = jest.fn();
const mockLogEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/posthog', () => ({
  posthog: { capture: (...a: unknown[]) => mockPh(...a) },
}));
jest.mock('@react-native-firebase/analytics', () => () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
  logScreenView: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => { mockPh.mockClear(); mockLogEvent.mockClear(); });

const props = () => (mockPh.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;

describe('the Thoughts funnel', () => {
  it('names both halves, so a rate can be computed at all', () => {
    Analytics.thoughtRepliesOpened('profile');
    Analytics.thoughtReplySent('profile');
    expect(mockPh.mock.calls.map((c) => c[0]))
      .toEqual(['thought_replies_opened', 'thought_reply_sent']);
  });

  it('separates the inline panel from a post’s own page', () => {
    // Both write the same comment row. Without this the experiment cannot be
    // read: the surface IS the change being measured.
    Analytics.thoughtRepliesOpened('profile');
    expect(props().surface).toBe('profile');
    mockPh.mockClear();
    Analytics.thoughtRepliesOpened('detail');
    expect(props().surface).toBe('detail');
  });

  it('carries no post, no author and nothing she typed', () => {
    Analytics.thoughtReplySent('profile');
    const payload = JSON.stringify(props());
    expect(payload).not.toMatch(/post|author|content|body|slug|user/i);
    expect(Object.keys(props())).toEqual(['surface']);
  });

  it('records the emoji on a reaction, which is the app’s own vocabulary', () => {
    // Six fixed values the app defines — not anything she wrote, so it
    // discloses nothing about her.
    Analytics.postReacted('❤️', 'profile');
    expect(mockPh.mock.calls[0][0]).toBe('post_reacted');
    expect(props()).toEqual({ emoji: '❤️', surface: 'profile' });
  });

  it('sends the same payload to both vendors', () => {
    // A field stripped from one and left in the other is the same disclosure
    // with half the evidence.
    Analytics.thoughtReplySent('profile');
    expect(JSON.stringify(mockLogEvent.mock.calls[0])).not.toMatch(/post|author|content/i);
  });
});
