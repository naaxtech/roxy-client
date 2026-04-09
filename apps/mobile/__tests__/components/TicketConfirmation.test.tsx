import React from 'react';
import { render } from '@testing-library/react-native';
import { TicketConfirmation } from '../../components/TicketConfirmation';

jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: () => null,
}));

const mockEvent = {
  title: 'Spring Mixer',
  starts_at: '2026-05-01T19:00:00Z',
  communities: { name: 'Queer Collective' },
};

describe('TicketConfirmation', () => {
  it('renders event title', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode="ROXY-ABCD1234EFGH5678"
        onViewTickets={() => {}}
      />
    );
    expect(getByText('Spring Mixer')).toBeTruthy();
  });

  it('renders ticket code', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode="ROXY-ABCD1234EFGH5678"
        onViewTickets={() => {}}
      />
    );
    expect(getByText('ROXY-ABCD1234EFGH5678')).toBeTruthy();
  });

  it('renders pending state when ticketCode is null', () => {
    const { getByText } = render(
      <TicketConfirmation
        event={mockEvent as any}
        ticketCode={null}
        onViewTickets={() => {}}
      />
    );
    expect(getByText(/arriving shortly/i)).toBeTruthy();
  });
});
