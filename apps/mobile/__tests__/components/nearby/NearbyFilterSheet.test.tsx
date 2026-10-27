/**
 * The nearby filter sheet: distance, kind of community (several at once),
 * how it meets, who can join. Choices are a draft until "Show communities";
 * Reset goes back to the defaults; reopening starts from what is applied.
 */
import 'react-native-gesture-handler/jestSetup';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { NearbyFilterSheet } from '../../../components/nearby/NearbyFilterSheet';
import { DEFAULT_NEARBY_FILTERS, type NearbyFilters } from '../../../lib/nearbyFilters';

const onApply = jest.fn();
const onClose = jest.fn();

function sheet(filters: NearbyFilters = DEFAULT_NEARBY_FILTERS, visible = true) {
  return <NearbyFilterSheet visible={visible} filters={filters} onApply={onApply} onClose={onClose} />;
}

beforeEach(() => {
  onApply.mockReset();
  onClose.mockReset();
});

describe('NearbyFilterSheet', () => {
  it('is the nearby-filters sheet with its four groups', () => {
    const v = render(sheet());
    expect(v.getByTestId('nearby-filters')).toBeTruthy();
    expect(v.getByText('Distance')).toBeTruthy();
    expect(v.getByText('Kind of community')).toBeTruthy();
    expect(v.getByText('Meets')).toBeTruthy();
    expect(v.getByText('Who can join')).toBeTruthy();
    expect(v.getByText('Anywhere in the country')).toBeTruthy();
  });

  it('applies every choice at once', () => {
    const v = render(sheet());
    fireEvent.press(v.getByTestId('nearby-filter-radius-25'));
    fireEvent.press(v.getByTestId('nearby-filter-category-support'));
    fireEvent.press(v.getByTestId('nearby-filter-category-identity'));
    fireEvent.press(v.getByTestId('nearby-filter-meets-in_person'));
    fireEvent.press(v.getByTestId('nearby-filter-join-open'));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.press(v.getByTestId('nearby-filters-apply'));
    expect(onApply).toHaveBeenCalledWith({ radiusKm: 25, categories: ['identity', 'support'], meets: 'in_person', openOnly: true });
  });

  it('categories are checkboxes: a second tap unchecks, and the state reaches web as aria-checked', () => {
    const v = render(sheet());
    const chip = () => v.getByTestId('nearby-filter-category-support');
    expect(chip().props.accessibilityRole).toBe('checkbox');
    expect(chip().props['aria-checked']).toBe(false);
    fireEvent.press(chip());
    expect(chip().props['aria-checked']).toBe(true);
    expect(chip().props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(chip());
    expect(chip().props['aria-checked']).toBe(false);
  });

  it('distance is a radio group: exactly one on', () => {
    const v = render(sheet());
    expect(v.getByTestId('nearby-filter-radius-50').props['aria-checked']).toBe(true);
    fireEvent.press(v.getByTestId('nearby-filter-radius-1000'));
    expect(v.getByTestId('nearby-filter-radius-1000').props['aria-checked']).toBe(true);
    expect(v.getByTestId('nearby-filter-radius-50').props['aria-checked']).toBe(false);
  });

  it('Reset goes back to the defaults', () => {
    const v = render(sheet({ radiusKm: 10, categories: ['support'], meets: 'both', openOnly: true }));
    fireEvent.press(v.getByTestId('nearby-filters-reset'));
    fireEvent.press(v.getByTestId('nearby-filters-apply'));
    expect(onApply).toHaveBeenCalledWith(DEFAULT_NEARBY_FILTERS);
  });

  it('reopening starts from what is applied, not from an abandoned draft', () => {
    const v = render(sheet());
    fireEvent.press(v.getByTestId('nearby-filter-radius-10'));
    v.rerender(sheet(DEFAULT_NEARBY_FILTERS, false));
    v.rerender(sheet(DEFAULT_NEARBY_FILTERS, true));
    fireEvent.press(v.getByTestId('nearby-filters-apply'));
    expect(onApply).toHaveBeenCalledWith(DEFAULT_NEARBY_FILTERS);
  });
});
