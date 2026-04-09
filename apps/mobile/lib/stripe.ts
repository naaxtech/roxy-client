import { useStripe } from '@stripe/stripe-react-native';
import { callEdgeFunction, supabase } from './supabase';
import { logError } from './errorLogger';

export function sanitizePaymentError(err: unknown): unknown {
  if (typeof err === 'object' && err !== null && 'client_secret' in err) {
    return { ...(err as object), client_secret: '[redacted]' };
  }
  return err;
}

export interface PurchaseTicketResult {
  success: boolean;
  ticketCode?: string | null;
  cancelled?: boolean;
  error?: string;
}

export async function purchaseTicket(
  eventId: string,
  initPaymentSheet: ReturnType<typeof useStripe>['initPaymentSheet'],
  presentPaymentSheet: ReturnType<typeof useStripe>['presentPaymentSheet'],
  userId: string,
): Promise<PurchaseTicketResult> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(eventId)) {
    return { success: false, error: 'Invalid event ID' };
  }

  let clientSecret: string;
  let publishableKey: string;

  try {
    const { data, error } = await callEdgeFunction<{ client_secret: string; publishable_key: string }>(
      'create-payment-intent',
      { event_id: eventId },
    );
    if (error || !data) throw new Error(error ?? 'No payment data returned');
    clientSecret = data.client_secret;
    publishableKey = data.publishable_key;
  } catch (err) {
    logError(sanitizePaymentError(err), 'purchaseTicket:createPaymentIntent');
    return { success: false, error: 'Could not initialise payment. Please try again.' };
  }

  const { error: initError } = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Roxy',
    applePay: { merchantCountryCode: 'US' },
    googlePay: { merchantCountryCode: 'US', testEnv: __DEV__ },
  });

  if (initError) {
    logError(sanitizePaymentError(initError), 'purchaseTicket:initPaymentSheet');
    return { success: false, error: 'Payment setup failed. Please try again.' };
  }

  const { error: presentError } = await presentPaymentSheet();

  if (presentError) {
    if (presentError.code === 'Canceled') {
      return { success: false, cancelled: true };
    }
    logError(sanitizePaymentError(presentError), 'purchaseTicket:presentPaymentSheet');
    return { success: false, error: presentError.message };
  }

  // Wait for webhook to create ticket via Supabase Realtime
  const ticketCode = await waitForTicket(eventId, userId);
  return { success: true, ticketCode };
}

async function waitForTicket(eventId: string, userId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      resolve(null);
    }, 30_000);

    const channel = supabase
      .channel(`ticket:${eventId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_attendees',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          if (payload.new?.user_id === userId) {
            clearTimeout(timeout);
            supabase.removeChannel(channel);
            resolve(payload.new.ticket_code ?? null);
          }
        },
      )
      .subscribe();
  });
}
