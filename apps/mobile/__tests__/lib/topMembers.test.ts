import { memberName, memberSubtitle, TOP_MEMBER_LIMIT, type TopMember } from '../../lib/topMembers';

const member = (over: Partial<TopMember> = {}): TopMember => ({
  id: 'u1', display_name: 'Maya', username: 'maya',
  avatar_url: null, gamification_points: 120, staff_tag: null, ...over,
});

describe('memberName', () => {
  it('prefers the display name, falls back to the handle', () => {
    expect(memberName(member())).toBe('Maya');
    expect(memberName(member({ display_name: '   ' }))).toBe('maya');
  });

  it('never shows a raw id when a profile has neither', () => {
    expect(memberName(member({ display_name: null, username: null }))).toBe('A member');
  });
});

describe('memberSubtitle', () => {
  it('shows the staff tag when there is one — it is why she is on the chart', () => {
    expect(memberSubtitle(member({ staff_tag: 'Archivist' }))).toBe('Archivist');
  });

  it('falls back to points, pluralised', () => {
    expect(memberSubtitle(member({ gamification_points: 1 }))).toBe('1 point');
    expect(memberSubtitle(member({ gamification_points: 42 }))).toBe('42 points');
  });

  it('treats a blank tag as no tag rather than printing an empty line', () => {
    expect(memberSubtitle(member({ staff_tag: '   ' }))).toBe('120 points');
  });

  it('never renders a negative score', () => {
    expect(memberSubtitle(member({ gamification_points: -5 }))).toBe('0 points');
  });
});

describe('the chart', () => {
  it('is ten', () => {
    expect(TOP_MEMBER_LIMIT).toBe(10);
  });
});
