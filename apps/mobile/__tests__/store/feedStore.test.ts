import { act, renderHook } from '@testing-library/react-native';
import { useFeedStore } from '../../store/feedStore';
import { Post, Event } from '../../types';

const makePost = (id: string, overrides: Partial<Post> = {}): Post => ({
  id,
  author_id: 'user-1',
  community_id: 'comm-1',
  content: 'Hello world',
  media_urls: [],
  post_type: 'standard',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeEvent = (id: string): Event => ({
  id,
  community_id: null,
  host_id: 'user-1',
  title: 'Test Event',
  description: null,
  event_type: 'online',
  starts_at: '2026-04-01T18:00:00Z',
  ends_at: null,
  location_text: null,
  location_url: null,
  max_attendees: null,
  attendee_count: 0,
  cover_image_url: null,
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  useFeedStore.setState({
    posts: [], events: [], loading: false,
    rsvpdEventIds: new Set(),
  });
});

describe('feedStore', () => {
  it('has correct initial state', () => {
    const { result } = renderHook(() => useFeedStore());
    expect(result.current.posts).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.rsvpdEventIds).toBeInstanceOf(Set);
  });

  it('setPosts replaces array', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1'), makePost('p2')]));
    expect(result.current.posts).toHaveLength(2);
    expect(result.current.posts[0].id).toBe('p1');
  });

  it('setEvents replaces array', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setEvents([makeEvent('e1')]));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe('e1');
  });

  it('upsertPost inserts new post', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.upsertPost(makePost('p1')));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].id).toBe('p1');
  });

  it('upsertPost updates existing post', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1', { content: 'original' })]));
    act(() => result.current.upsertPost(makePost('p1', { content: 'updated' })));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].content).toBe('updated');
  });

  it('setLoading toggles loading state', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setLoading(true));
    expect(result.current.loading).toBe(true);
    act(() => result.current.setLoading(false));
    expect(result.current.loading).toBe(false);
  });

  it('incrementReaction updates reaction counts', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1', { reaction_counts: { '🌸': 2 } })]));
    act(() => result.current.incrementReaction('p1', '🌸'));
    expect(result.current.posts[0].reaction_counts['🌸']).toBe(3);
  });

  it('markRsvpd adds event id to Set', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.markRsvpd('e1'));
    expect(result.current.rsvpdEventIds.has('e1')).toBe(true);
  });
});
