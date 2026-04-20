import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BusinessForm } from '@/app/(dashboard)/settings/BusinessForm';

jest.mock('@/app/(dashboard)/settings/business-actions', () => ({
  createBusiness: jest.fn().mockResolvedValue({}),
  updateBusiness: jest.fn().mockResolvedValue({}),
}));
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://cdn.example.com/logo.jpg' } })),
      })),
    },
  })),
}));
jest.mock('next/navigation', () => ({ useRouter: jest.fn(() => ({ refresh: jest.fn() })) }));

describe('BusinessForm', () => {
  it('renders create mode with submit button', () => {
    render(<BusinessForm userId="user-1" />);
    expect(screen.getByRole('button', { name: /submit business/i })).toBeInTheDocument();
  });

  it('renders edit mode with save button and pre-filled name', () => {
    const business = {
      id: 'biz-1', name: 'Test Biz', description: null, category: null,
      location_city: null, website_url: null, instagram_handle: null,
      tiktok_handle: null, facebook_url: null, contact_email: null,
      phone: null, logo_url: null, is_wlw_owned: false,
      business_rejection_reason: null, stripe_account_id: null,
      stripe_onboarded_at: null, can_sell: false, is_verified: false,
      payout_schedule_set: false,
    };
    render(<BusinessForm userId="user-1" business={business} />);
    expect(screen.getByDisplayValue('Test Biz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('shows inline error when createBusiness returns error', async () => {
    const { createBusiness } = jest.requireMock('@/app/(dashboard)/settings/business-actions');
    createBusiness.mockResolvedValueOnce({ error: 'Business name is required' });
    render(<BusinessForm userId="user-1" />);
    const submitButton = screen.getByRole('button', { name: /submit business/i });
    fireEvent.click(submitButton);
    await waitFor(() => {
      expect(screen.getByText('Business name is required')).toBeInTheDocument();
    });
  });
});
