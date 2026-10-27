import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateCommunityForm } from '@/app/(dashboard)/community/CreateCommunityForm';

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

const MANILA = { id: 1701668, name: 'Manila', admin1: 'Metro Manila', country_code: 'PH', population: 1600000 };
const NEW_ID = '7d1c2a44-0f0e-4b2b-9a51-3c1d2e3f4a5b';

type RpcResult = { data: unknown; error: { code: string; message: string } | null };

function routeRpc(overrides: Partial<Record<string, RpcResult>> = {}) {
  mockRpc.mockImplementation((fn: string) => {
    if (overrides[fn]) return Promise.resolve(overrides[fn]);
    if (fn === 'search_cities') return Promise.resolve({ data: [MANILA], error: null });
    if (fn === 'create_community') {
      return Promise.resolve({ data: { id: NEW_ID, name: 'Manila Sapphics' }, error: null });
    }
    if (fn === 'set_community_location') {
      return Promise.resolve({ data: { id: NEW_ID, city_id: MANILA.id, meets: 'in_person' }, error: null });
    }
    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `unexpected ${fn}` } });
  });
}

function calledFunctions(): string[] {
  return mockRpc.mock.calls.map((call) => call[0] as string);
}

async function pickManila() {
  fireEvent.change(screen.getByRole('combobox', { name: /city/i }), { target: { value: 'Man' } });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  fireEvent.click(await screen.findByRole('option', { name: 'Manila, Metro Manila, Philippines' }));
}

function fillName(value = 'Manila Sapphics') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value } });
}

describe('CreateCommunityForm — where it meets', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRpc.mockReset();
    mockRefresh.mockReset();
    routeRpc();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers City and Meets, Meets defaulting to Online', () => {
    render(<CreateCommunityForm />);
    expect(screen.getByRole('combobox', { name: /city/i })).toBeInTheDocument();
    const meets = screen.getByLabelText('Meets');
    expect(meets).toHaveValue('online');
    expect(screen.getByRole('option', { name: 'In person' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Both' })).toBeInTheDocument();
  });

  it('without a city, creates exactly as before and never sets a location', async () => {
    render(<CreateCommunityForm />);
    fillName();
    fireEvent.click(screen.getByRole('button', { name: /create community/i }));

    expect(await screen.findByText(/community created — you're its admin/i)).toBeInTheDocument();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('create_community', {
      p_name: 'Manila Sapphics',
      p_slug: 'manila-sapphics',
      p_description: null,
      p_category: 'interest',
      p_is_private: false,
    });
    expect(calledFunctions()).not.toContain('set_community_location');
  });

  it('sets the location on the new community right after create succeeds', async () => {
    render(<CreateCommunityForm />);
    fillName();
    await pickManila();
    fireEvent.change(screen.getByLabelText('Meets'), { target: { value: 'in_person' } });
    fireEvent.click(screen.getByRole('button', { name: /create community/i }));

    await waitFor(() => expect(calledFunctions()).toContain('set_community_location'));
    expect(calledFunctions()).toEqual(['search_cities', 'create_community', 'set_community_location']);
    expect(mockRpc).toHaveBeenLastCalledWith('set_community_location', {
      p_community_id: NEW_ID,
      p_city_id: MANILA.id,
      p_meets: 'in_person',
    });
    expect(await screen.findByText(/community created — you're its admin/i)).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('says the community exists but the location did not save, without a success toast', async () => {
    routeRpc({
      set_community_location: {
        data: null,
        error: { code: 'XX000', message: `internal failure for ${NEW_ID}` },
      },
    });
    render(<CreateCommunityForm />);
    fillName();
    await pickManila();
    fireEvent.click(screen.getByRole('button', { name: /create community/i }));

    expect(
      await screen.findByText(/Community created, but its location wasn't saved — set it from Edit/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/you're its admin/i)).toBeNull();
    expect(screen.queryByText(new RegExp(NEW_ID))).toBeNull();
    expect(screen.queryByText(/internal failure/)).toBeNull();
    // The community does exist, so the list must pick it up.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('asks for a city before creating a community that meets in person', async () => {
    render(<CreateCommunityForm />);
    fillName();
    fireEvent.change(screen.getByLabelText('Meets'), { target: { value: 'both' } });
    fireEvent.click(screen.getByRole('button', { name: /create community/i }));

    expect(await screen.findByText(/pick a city/i)).toBeInTheDocument();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
