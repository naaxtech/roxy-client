import type { PostgrestError } from '@supabase/supabase-js';
import {
  citySearchErrorMessage,
  describeLocation,
  formatCityLabel,
  isLocationSchemaMissing,
  locationSaveErrorMessage,
  needsLocationCall,
  toCommunityLocation,
} from '@/lib/communityLocation';

const MANILA = { id: 1701668, name: 'Manila', admin1: 'Metro Manila', country_code: 'PH' };

function pgError(code: string, message: string): PostgrestError {
  return { code, message, details: '', hint: '', name: 'PostgrestError' } as PostgrestError;
}

describe('formatCityLabel', () => {
  it('reads "City, Region, Country" with the country spelled out', () => {
    expect(formatCityLabel(MANILA)).toBe('Manila, Metro Manila, Philippines');
  });

  it('drops a missing region and a region that repeats the city', () => {
    expect(formatCityLabel({ id: 1, name: 'Singapore', admin1: null, country_code: 'SG' })).toBe('Singapore');
    expect(formatCityLabel({ id: 2, name: 'Mexico City', admin1: 'Mexico City', country_code: 'MX' })).toBe(
      'Mexico City, Mexico',
    );
  });
});

describe('needsLocationCall', () => {
  it('is false for the default (no city, online) so create stays one call', () => {
    expect(needsLocationCall(null, 'online')).toBe(false);
  });

  it('is true once a city or an in-person meeting is chosen', () => {
    expect(needsLocationCall(MANILA, 'online')).toBe(true);
    expect(needsLocationCall(MANILA, 'in_person')).toBe(true);
    expect(needsLocationCall(null, 'both')).toBe(true);
  });
});

describe('locationSaveErrorMessage', () => {
  it('turns the permission refusal into a sentence about who may do it', () => {
    const message = locationSaveErrorMessage(
      pgError('42501', 'only the people who run this community can set where it meets'),
    );
    expect(message).toMatch(/only this community's owner, admins, moderators or Roxy staff/i);
  });

  it('says the feature is not live yet when the function is missing', () => {
    expect(locationSaveErrorMessage(pgError('PGRST202', 'Could not find the function'))).toMatch(
      /isn't available yet/i,
    );
  });

  it('asks for a city when the database says in-person needs one', () => {
    expect(
      locationSaveErrorMessage(pgError('22023', 'a community that meets in person needs a city')),
    ).toMatch(/pick a city/i);
  });

  it('never echoes the raw database text', () => {
    const raw = 'duplicate key 3f2a9c1e-0000-4000-8000-000000000000 from someone@example.com';
    const message = locationSaveErrorMessage(pgError('XX000', raw));
    expect(message).not.toContain('3f2a9c1e');
    expect(message).not.toContain('@');
    expect(message).toMatch(/couldn't save/i);
  });
});

describe('citySearchErrorMessage', () => {
  it('distinguishes "not live yet" from a failure, without the raw text', () => {
    expect(citySearchErrorMessage(pgError('42883', 'function search_cities(text) does not exist'))).toMatch(
      /isn't available yet/i,
    );
    const failed = citySearchErrorMessage(pgError('57014', 'canceling statement due to statement timeout'));
    expect(failed).toMatch(/couldn't search cities/i);
    expect(failed).not.toMatch(/canceling/);
  });
});

describe('toCommunityLocation', () => {
  it('reads an embedded city object', () => {
    expect(toCommunityLocation({ id: 'c-1', meets: 'both', city_id: MANILA.id, cities: MANILA })).toEqual({
      city: MANILA,
      meets: 'both',
    });
  });

  it('reads an embedded city array and falls back to online for unknown meets', () => {
    expect(toCommunityLocation({ id: 'c-1', meets: 'sometimes', city_id: MANILA.id, cities: [MANILA] })).toEqual({
      city: MANILA,
      meets: 'online',
    });
  });

  it('has no city when the row has none', () => {
    expect(toCommunityLocation({ id: 'c-1', meets: 'online', city_id: null, cities: null })).toEqual({
      city: null,
      meets: 'online',
    });
  });
});

describe('describeLocation', () => {
  it('summarises where a community meets', () => {
    expect(describeLocation({ city: null, meets: 'online' })).toBe('Online only');
    expect(describeLocation({ city: MANILA, meets: 'in_person' })).toBe(
      'In person · Manila, Metro Manila, Philippines',
    );
    expect(describeLocation({ city: MANILA, meets: 'both' })).toBe(
      'Online and in person · Manila, Metro Manila, Philippines',
    );
    expect(describeLocation({ city: MANILA, meets: 'online' })).toBe(
      'Online · based in Manila, Metro Manila, Philippines',
    );
  });
});

describe('isLocationSchemaMissing', () => {
  it('treats a missing column, table or relationship as "not applied yet"', () => {
    expect(isLocationSchemaMissing(pgError('42703', 'column communities.meets does not exist'))).toBe(true);
    expect(isLocationSchemaMissing(pgError('PGRST200', 'Could not find a relationship'))).toBe(true);
    expect(isLocationSchemaMissing(pgError('PGRST205', 'Could not find the table'))).toBe(true);
    expect(isLocationSchemaMissing(pgError('57014', 'timeout'))).toBe(false);
    expect(isLocationSchemaMissing(null)).toBe(false);
  });
});
