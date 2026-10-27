import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityLocationEditor } from '@/app/(dashboard)/community/CommunityLocationEditor';
import type { CommunityLocation } from '@/lib/communityLocation';

const mockRpc = jest.fn();
const mockRefresh = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  })),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }),
}));

const COMMUNITY_ID = '0b6f3c1e-9a2d-4c51-8e7f-112233445566';
const MANILA = { id: 1701668, name: 'Manila', admin1: 'Metro Manila', country_code: 'PH' };
const QUEZON = { id: 1692192, name: 'Quezon City', admin1: 'Metro Manila', country_code: 'PH', population: 2700000 };

function renderEditor(initial: CommunityLocation = { city: MANILA, meets: 'both' }) {
  return render(
    <CommunityLocationEditor communityId={COMMUNITY_ID} communityName="Manila Sapphics" initial={initial} />,
  );
}

describe('CommunityLocationEditor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRpc.mockReset();
    mockRefresh.mockReset();
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'search_cities') return Promise.resolve({ data: [QUEZON], error: null });
      return Promise.resolve({ data: { id: COMMUNITY_ID }, error: null });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows where the community meets now', () => {
    renderEditor();
    expect(screen.getByText('Online and in person · Manila, Metro Manila, Philippines')).toBeInTheDocument();
  });

  it('prefills the city and meets from the community', () => {
    renderEditor();
    const toggle = screen.getByRole('button', { name: /edit location/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    expect(screen.getByRole('combobox', { name: /city/i })).toHaveValue('Manila, Metro Manila, Philippines');
    expect(screen.getByLabelText('Meets')).toHaveValue('both');
    expect(screen.getByText('City data © GeoNames (CC BY 4.0)')).toBeInTheDocument();
  });

  it('saves a new city and meets through set_community_location', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }));

    fireEvent.change(screen.getByRole('combobox', { name: /city/i }), { target: { value: 'Que' } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    fireEvent.click(await screen.findByRole('option', { name: 'Quezon City, Metro Manila, Philippines' }));
    fireEvent.change(screen.getByLabelText('Meets'), { target: { value: 'in_person' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('set_community_location', {
        p_community_id: COMMUNITY_ID,
        p_city_id: QUEZON.id,
        p_meets: 'in_person',
      }),
    );
    expect(await screen.findByText('Location saved.')).toBeInTheDocument();
    expect(screen.getByText('In person · Quezon City, Metro Manila, Philippines')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('removes the location: no city, online', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove location/i }));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('set_community_location', {
        p_community_id: COMMUNITY_ID,
        p_city_id: null,
        p_meets: 'online',
      }),
    );
    expect(await screen.findByText('Location removed.')).toBeInTheDocument();
    expect(screen.getByText('Online only')).toBeInTheDocument();
  });

  it('offers no Remove when there is nothing to remove', () => {
    renderEditor({ city: null, meets: 'online' });
    expect(screen.getByText('Online only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }));
    expect(screen.queryByRole('button', { name: /remove location/i })).toBeNull();
  });

  it('asks for a city before saving an in-person community without one', async () => {
    renderEditor({ city: null, meets: 'online' });
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }));
    fireEvent.change(screen.getByLabelText('Meets'), { target: { value: 'in_person' } });
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/pick a city/i);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('turns the RPC permission refusal into a human message', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only the people who run this community can set where it meets' },
    });
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }));
    fireEvent.click(screen.getByRole('button', { name: /save location/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/only this community's owner, admins, moderators or Roxy staff/i);
    expect(alert).not.toHaveTextContent(COMMUNITY_ID);
    expect(screen.queryByText('Location saved.')).toBeNull();
    // The summary still tells the truth: nothing changed.
    expect(screen.getByText('Online and in person · Manila, Metro Manila, Philippines')).toBeInTheDocument();
  });
});
