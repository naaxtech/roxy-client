import { getAuthContext, proxyToEdge } from '@/lib/staff-auth';
import { NextResponse } from 'next/server';

// Returns a Stripe Express dashboard login link for the authenticated host
export async function POST() {
  const auth = await getAuthContext();
  if ('error' in auth) return auth.error;

  return proxyToEdge('stripe-dashboard-link', auth.ctx.accessToken, {});
}
