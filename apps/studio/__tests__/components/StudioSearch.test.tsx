import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StudioSearch } from '@/components/StudioSearch';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('StudioSearch', () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it('is a regular search field, not a modal launcher', () => {
    render(<StudioSearch isStaff isCore />);
    const input = screen.getByRole('combobox', { name: /search studio/i });
    expect(input).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^search$/i })).toBeNull();
  });

  it('lists matches under the field as she types', () => {
    render(<StudioSearch isStaff isCore />);
    const input = screen.getByRole('combobox', { name: /search studio/i });
    fireEvent.focus(input);
    expect(screen.queryByTestId('studio-search-results')).toBeNull();

    fireEvent.change(input, { target: { value: 'entries' } });
    const results = screen.getByTestId('studio-search-results');
    expect(results).toBeInTheDocument();
    expect(results.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByRole('option', { name: /entries/i })).toBeInTheDocument();
  });

  it('opens the chosen page from a result', () => {
    render(<StudioSearch isStaff isCore />);
    const input = screen.getByRole('combobox', { name: /search studio/i });
    fireEvent.change(input, { target: { value: 'settings' } });
    fireEvent.click(screen.getByRole('option', { name: /settings/i }));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
