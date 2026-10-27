/**
 * The city picker: a debounced `search_cities` from two characters, answers
 * that arrive late are dropped, results read "City, Region, Country", the
 * GeoNames credit is on the sheet, and her location is offered only in a way
 * that cannot re-ask after she said no: "Use my location instead" before a
 * refusal, "Open settings" after one (native), nothing where there is no
 * settings page to send her to (web).
 */
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/nearby', () => {
  const actual = jest.requireActual('../../../lib/nearby');
  return { ...actual, searchCities: jest.fn() };
});

import { CityPickerSheet, CITY_SEARCH_DEBOUNCE_MS } from '../../../components/nearby/CityPickerSheet';

const { searchCities } = jest.requireMock('../../../lib/nearby') as { searchCities: jest.Mock };

const QC = { id: 1692192, name: 'Quezon City', admin1: 'Metro Manila', country_code: 'PH', population: 2_761_720 };
const QZ = { id: 3520339, name: 'Quezaltepeque', admin1: null, country_code: 'SV', population: 30_000 };

const onChoose = jest.fn();
const onUseLocation = jest.fn();
const onOpenSettings = jest.fn();
const onClose = jest.fn();

function open(location: 'ask' | 'settings' | 'none' = 'ask') {
  return render(
    <CityPickerSheet
      visible
      onClose={onClose}
      onChoose={onChoose}
      location={location}
      onUseLocation={onUseLocation}
      onOpenSettings={onOpenSettings}
    />,
  );
}

async function settle(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  jest.useFakeTimers();
  searchCities.mockReset().mockResolvedValue([QC]);
  onChoose.mockReset();
  onUseLocation.mockReset();
  onOpenSettings.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CityPickerSheet', () => {
  it('opens as the city picker with a labelled search field', () => {
    const v = open();
    expect(v.getByTestId('city-picker')).toBeTruthy();
    expect(v.getByLabelText('Search for a city')).toBeTruthy();
  });

  it('one letter asks nothing and says how many it needs', async () => {
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Q');
    await settle(CITY_SEARCH_DEBOUNCE_MS * 2);
    expect(searchCities).not.toHaveBeenCalled();
    expect(v.getByText(/at least two letters/)).toBeTruthy();
  });

  it('waits for her to pause, then searches once with the last thing typed', async () => {
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Qu');
    await settle(CITY_SEARCH_DEBOUNCE_MS - 50);
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Quez');
    await settle(CITY_SEARCH_DEBOUNCE_MS - 1);
    expect(searchCities).not.toHaveBeenCalled();
    await settle(1);
    expect(searchCities).toHaveBeenCalledTimes(1);
    expect(searchCities).toHaveBeenCalledWith('Quez');
  });

  it('results read "City, Region, Country"; choosing one hands back its id and label', async () => {
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Quezon');
    await settle(CITY_SEARCH_DEBOUNCE_MS);
    const option = v.getByTestId(`city-option-${QC.id}`);
    expect(option).toHaveTextContent(/^Quezon City, Metro Manila, /);
    fireEvent.press(option);
    expect(onChoose).toHaveBeenCalledWith({ id: QC.id, label: expect.stringMatching(/^Quezon City, Metro Manila, /) });
  });

  it('an answer that lands after a newer search is dropped', async () => {
    let resolveFirst: (rows: unknown) => void = () => undefined;
    searchCities
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([QC]);
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Qz');
    await settle(CITY_SEARCH_DEBOUNCE_MS);
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Quezon');
    await settle(CITY_SEARCH_DEBOUNCE_MS);
    await act(async () => { resolveFirst([QZ]); });
    expect(v.getByTestId(`city-option-${QC.id}`)).toBeTruthy();
    expect(v.queryByTestId(`city-option-${QZ.id}`)).toBeNull();
  });

  it('no match: says so and what to try', async () => {
    searchCities.mockResolvedValue([]);
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Zzyzx');
    await settle(CITY_SEARCH_DEBOUNCE_MS);
    expect(v.getByTestId('city-picker-empty')).toBeTruthy();
  });

  it('a failed search: one sentence and Try again', async () => {
    searchCities.mockResolvedValueOnce(null).mockResolvedValueOnce([QC]);
    const v = open();
    fireEvent.changeText(v.getByTestId('city-picker-input'), 'Quezon');
    await settle(CITY_SEARCH_DEBOUNCE_MS);
    expect(v.getByTestId('city-picker-error')).toBeTruthy();
    fireEvent.press(v.getByText('Try again'));
    await settle(0);
    expect(searchCities).toHaveBeenCalledTimes(2);
    expect(v.getByTestId(`city-option-${QC.id}`)).toBeTruthy();
  });

  it('before any refusal: "Use my location instead"', () => {
    const v = open('ask');
    fireEvent.press(v.getByTestId('city-use-location'));
    expect(onUseLocation).toHaveBeenCalledTimes(1);
    expect(v.queryByTestId('city-open-settings')).toBeNull();
  });

  it('after she said no (native): never "Use my location" again, only a tap that says it opens Settings', () => {
    const v = open('settings');
    expect(v.queryByTestId('city-use-location')).toBeNull();
    expect(v.queryByText(/Use my location/)).toBeNull();
    const settings = v.getByTestId('city-open-settings');
    expect(settings).toHaveTextContent('Turn on location in Settings');
    expect(v.getByLabelText('Open Settings to turn on location')).toBeTruthy();
    fireEvent.press(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onUseLocation).not.toHaveBeenCalled();
  });

  it('after she said no where there is no Settings to open (web): no location offer at all', () => {
    const v = open('none');
    expect(v.queryByTestId('city-use-location')).toBeNull();
    expect(v.queryByTestId('city-open-settings')).toBeNull();
    expect(v.getByTestId('city-picker-input')).toBeTruthy();
  });

  it('credits GeoNames (CC BY 4.0) for the city names', () => {
    const v = open();
    expect(v.getByTestId('city-picker-attribution')).toHaveTextContent('City data © GeoNames (CC BY 4.0)');
  });
});
