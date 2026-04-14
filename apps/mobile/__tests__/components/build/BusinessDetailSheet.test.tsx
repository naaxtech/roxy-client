import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { Business, BusinessPhoto } from '../../../types';

const makeBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: 'b1',
  owner_id: 'user-1',
  name: 'Lavender Books',
  description: 'A queer bookshop',
  category: 'retail',
  location_city: 'London',
  website_url: 'https://lavenderbooks.com',
  instagram_handle: 'lavenderbooks',
  logo_url: null,
  is_verified: true,
  is_wlw_owned: true,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const _makePhoto = (id: string): BusinessPhoto => ({
  id,
  business_id: 'b1',
  url: `https://example.com/photo-${id}.jpg`,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
});

describe('BusinessDetailSheet', () => {
  it('renders nothing when business is null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={null}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('Lavender Books')).toBeNull();
  });

  it('renders business name and city', () => {
    const { getByText } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByText('Lavender Books')).toBeTruthy();
    expect(getByText('📍 London')).toBeTruthy();
  });

  it('does not render gallery when photos is empty', () => {
    const { queryByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByTestId('photo-gallery')).toBeNull();
  });

  it('does not render links section when all links are null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={makeBusiness({ website_url: null, instagram_handle: null })}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('🔗 Links')).toBeNull();
  });

  it('calls onBookmarkToggle when bookmark button pressed', () => {
    const onBookmarkToggle = jest.fn();
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={onBookmarkToggle}
        onClose={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('bookmark-btn'));
    expect(onBookmarkToggle).toHaveBeenCalled();
  });

  it('shows filled bookmark when isBookmarked is true', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={true}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Remove bookmark');
  });

  it('shows outline bookmark when isBookmarked is false', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Add bookmark');
  });
});
