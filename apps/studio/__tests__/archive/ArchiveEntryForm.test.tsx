import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchiveEntryForm } from '@/app/(dashboard)/staff/archive/entries/ArchiveEntryForm';
import { ARCHIVE_DELETE_PHRASE } from '@/lib/archiveEntry';

const mockRpc = jest.fn();
const mockRefresh = jest.fn();
const mockPush = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: () => ({
        upload: jest.fn(),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.test/c.jpg' } }),
      }),
    },
  })),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

const ENTRY = {
  id: 'e-1',
  slug: 'portrait-of-a-lady-on-fire',
  title: 'Portrait of a Lady on Fire',
  media_type: 'film' as const,
  release_year: 2019,
  creator: 'Céline Sciamma',
  length_label: '2h 2m',
  summary: 'Two women fall in love on an island in Brittany.',
  cover_url: null,
  cover_gradient: null,
  status: 'published' as const,
};

describe('ArchiveEntryForm', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    mockRpc.mockResolvedValue({ data: ENTRY.id, error: null });
  });

  it('saves editorial fields through staff_save_archive_entry', async () => {
    render(<ArchiveEntryForm entry={ENTRY} photos={[]} />);
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Portrait of a Lady on Fire (restored)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'staff_save_archive_entry',
        expect.objectContaining({
          p_id: 'e-1',
          p_title: 'Portrait of a Lady on Fire (restored)',
          p_media_type: 'film',
          p_status: 'published',
        }),
      );
    });
  });

  it('keeps permanent delete disabled until every confirmation is met', async () => {
    render(<ArchiveEntryForm entry={ENTRY} photos={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /permanently delete this entry/i }));

    const destroy = screen.getByRole('button', { name: /delete this entry forever/i });
    expect(destroy).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type the title exactly/i), {
      target: { value: ENTRY.title },
    });
    fireEvent.change(screen.getByLabelText(/DELETE THIS ENTRY/i), {
      target: { value: ARCHIVE_DELETE_PHRASE },
    });
    fireEvent.change(screen.getByLabelText(/why this has to go/i), {
      target: { value: 'Duplicate of the restored listing members are already scoring.' },
    });
    fireEvent.click(screen.getByRole('checkbox'));

    expect(destroy).toBeEnabled();
    fireEvent.click(destroy);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'staff_delete_archive_entry',
        expect.objectContaining({
          p_id: 'e-1',
          p_confirm_title: ENTRY.title,
          p_confirm_phrase: ARCHIVE_DELETE_PHRASE,
        }),
      );
    });
    expect(mockPush).toHaveBeenCalledWith('/staff/archive/entries');
  });
});
