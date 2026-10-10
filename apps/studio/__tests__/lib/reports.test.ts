import {
  REPORT_CONTENT_TYPES,
  canHide,
  parseReportFilters,
  resolutionFor,
  resolveErrorMessage,
  resolveSuccessMessage,
  contentTypeLabel,
  reasonLabel,
} from '@/lib/reports';

describe('report content types', () => {
  it('covers every type submit-report accepts', () => {
    expect([...REPORT_CONTENT_TYPES].sort()).toEqual(
      ['archive_entry', 'archive_review', 'message', 'post', 'profile', 'room', 'speed_date'].sort(),
    );
  });

  it('only offers Hide for content staff_resolve_report can hide', () => {
    expect(canHide('post')).toBe(true);
    expect(canHide('archive_entry')).toBe(true);
    expect(canHide('archive_review')).toBe(true);
    expect(canHide('room')).toBe(true);
    expect(canHide('message')).toBe(false);
    expect(canHide('profile')).toBe(false);
    expect(canHide('speed_date')).toBe(false);
  });

  it('labels types and reasons for humans', () => {
    expect(contentTypeLabel('speed_date')).toBe('Speed date');
    expect(contentTypeLabel('archive_review')).toBe('Archive review');
    expect(reasonLabel('hate_speech')).toBe('Hate speech');
    expect(reasonLabel('archive_spoiler')).toBe('Archive spoiler');
    expect(reasonLabel('something_new')).toBe('something_new');
  });
});

describe('parseReportFilters', () => {
  it('defaults to pending, every type', () => {
    expect(parseReportFilters({})).toEqual({ status: 'pending', type: 'all' });
  });

  it('accepts known values and ignores anything else', () => {
    expect(parseReportFilters({ status: 'dismissed', type: 'message' })).toEqual({
      status: 'dismissed',
      type: 'message',
    });
    expect(parseReportFilters({ status: 'all', type: 'archive_entry' })).toEqual({
      status: 'all',
      type: 'archive_entry',
    });
    expect(parseReportFilters({ status: "pending'; drop", type: 'posts' })).toEqual({
      status: 'pending',
      type: 'all',
    });
    expect(parseReportFilters({ status: ['actioned', 'x'], type: undefined })).toEqual({
      status: 'actioned',
      type: 'all',
    });
  });
});

describe('resolutionFor', () => {
  it('maps each staff choice onto staff_resolve_report arguments', () => {
    expect(resolutionFor('dismiss')).toEqual({ p_action: 'dismiss', p_suspend_author: false });
    expect(resolutionFor('action')).toEqual({ p_action: 'action', p_suspend_author: false });
    expect(resolutionFor('hide')).toEqual({ p_action: 'hide', p_suspend_author: false });
    expect(resolutionFor('suspend')).toEqual({ p_action: 'action', p_suspend_author: true });
    expect(resolutionFor('hide_suspend')).toEqual({ p_action: 'hide', p_suspend_author: true });
  });

  it('rejects anything else', () => {
    expect(resolutionFor('delete' as never)).toBeNull();
  });
});

describe('resolve messages', () => {
  it('turns a missing RPC into a "not deployed" message', () => {
    expect(resolveErrorMessage({ code: 'PGRST202', message: 'x' })).toMatch(/migration 131/);
  });

  it('explains permission and already-resolved errors', () => {
    expect(resolveErrorMessage({ code: '42501', message: 'Only Roxy staff can resolve reports' })).toMatch(
      /staff/i,
    );
    expect(resolveErrorMessage({ code: '55000', message: 'This report was already resolved' })).toMatch(
      /already resolved/i,
    );
  });

  it('passes the RPC wording through for validation errors', () => {
    expect(
      resolveErrorMessage({
        code: '22023',
        message: 'A message report cannot be hidden from here; action it and suspend the member',
      }),
    ).toBe('A message report cannot be hidden from here; action it and suspend the member');
  });

  it('never shows raw SQL for unknown errors', () => {
    expect(resolveErrorMessage({ code: 'XX000', message: 'relation foo does not exist' })).toBe(
      'Could not resolve that report. Nothing was changed — try again.',
    );
  });

  it('reports what the server actually did', () => {
    expect(resolveSuccessMessage({ status: 'dismissed', resolved: 1, hidden: false, suspension_id: null })).toBe(
      'Dismissed 1 report.',
    );
    expect(resolveSuccessMessage({ status: 'actioned', resolved: 3, hidden: true, suspension_id: null })).toBe(
      'Actioned 3 reports. The content is hidden.',
    );
    expect(
      resolveSuccessMessage({ status: 'actioned', resolved: 1, hidden: false, suspension_id: 'abc' }),
    ).toBe('Actioned 1 report. The member is suspended.');
    expect(
      resolveSuccessMessage({ status: 'actioned', resolved: 2, hidden: true, suspension_id: 'abc' }),
    ).toBe('Actioned 2 reports. The content is hidden. The member is suspended.');
  });
});
