import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CityCombobox } from '@/app/(dashboard)/community/CityCombobox';
import type { CityOption } from '@/lib/communityLocation';

const mockRpc = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  })),
}));

const MANILA = { id: 1701668, name: 'Manila', admin1: 'Metro Manila', country_code: 'PH', population: 1600000 };
const QUEZON = { id: 1692192, name: 'Quezon City', admin1: 'Metro Manila', country_code: 'PH', population: 2700000 };

function Harness({ onPick, initial = null }: { onPick?: (city: CityOption | null) => void; initial?: CityOption | null }) {
  const [city, setCity] = useState<CityOption | null>(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <CityCombobox
        id="city"
        value={city}
        onChange={(next) => {
          setCity(next);
          onPick?.(next);
        }}
      />
    </form>
  );
}

async function settle(ms = 300) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('CityCombobox', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: [QUEZON, MANILA], error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a labelled combobox with the GeoNames attribution beside it', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /city/i });
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('City data © GeoNames (CC BY 4.0)')).toBeInTheDocument();
  });

  it('waits for two characters before it searches', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /city/i });
    fireEvent.change(input, { target: { value: 'M' } });
    await settle(1000);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByText(/type at least 2 letters/i)).toBeInTheDocument();
  });

  it('debounces typing into one search_cities call', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /city/i });
    fireEvent.change(input, { target: { value: 'Ma' } });
    await settle(100);
    fireEvent.change(input, { target: { value: 'Man' } });
    await settle(100);
    expect(mockRpc).not.toHaveBeenCalled();

    await settle(300);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('search_cities', { p_q: 'Man' });
    expect(await screen.findByRole('option', { name: 'Manila, Metro Manila, Philippines' })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('picks a city with the keyboard and keeps Enter from submitting the form', async () => {
    const onPick = jest.fn();
    render(<Harness onPick={onPick} />);
    const input = screen.getByRole('combobox', { name: /city/i });
    fireEvent.change(input, { target: { value: 'Man' } });
    await settle();
    await screen.findByRole('option', { name: 'Quezon City, Metro Manila, Philippines' });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = screen.getByRole('option', { name: 'Manila, Metro Manila, Philippines' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);

    const enter = fireEvent.keyDown(input, { key: 'Enter' });
    expect(enter).toBe(false);
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: MANILA.id, name: 'Manila' }));
    expect(input).toHaveValue('Manila, Metro Manila, Philippines');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the list on Escape', async () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /city/i });
    fireEvent.change(input, { target: { value: 'Man' } });
    await settle();
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says so when nothing matches', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: /city/i }), { target: { value: 'Zzq' } });
    await settle();
    expect(await screen.findByText(/no cities match/i)).toBeInTheDocument();
  });

  it('shows a human error, never the database text', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    render(<Harness />);
    fireEvent.change(screen.getByRole('combobox', { name: /city/i }), { target: { value: 'Man' } });
    await settle();
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't search cities/i);
    expect(screen.queryByText(/canceling statement/)).toBeNull();
  });

  it('clears the chosen city as soon as she types over it', async () => {
    const onPick = jest.fn();
    render(<Harness onPick={onPick} initial={MANILA} />);
    const input = screen.getByRole('combobox', { name: /city/i });
    expect(input).toHaveValue('Manila, Metro Manila, Philippines');
    await settle(1000);
    expect(mockRpc).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Que' } });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
});
