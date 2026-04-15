import Link from 'next/link';
import {
  Calendar, Users, DollarSign, Package,
  ShoppingCart, ArrowUpRight, AlertCircle,
  Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  gradient: string;
  iconColor: string;
  href?: string;
  badge?: string;
}

function MetricCard({ title, value, description, icon: Icon, gradient, iconColor, href, badge }: MetricCardProps) {
  const content = (
    <Card className={cn('card-hover border-border/60 overflow-hidden relative group', gradient)}>
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: 'linear-gradient(135deg, hsl(330 73% 70% / 0.04), transparent)' }}
      />
      <CardHeader className="flex flex-row items-start justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconColor)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
          {badge && (
            <Badge variant="default" className="mb-0.5 text-[10px]">{badge}</Badge>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground mt-1.5">{description}</p>}
        {href && (
          <p className="mt-3 text-xs text-primary/70 flex items-center gap-1 group-hover:text-primary transition-colors">
            View details <ArrowUpRight className="h-3 w-3" />
          </p>
        )}
      </CardContent>
    </Card>
  );

  if (href) return <Link href={href} className="block">{content}</Link>;
  return content;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const [
    { data: stripeAccount },
    { data: memberRows },
    { data: profile },
  ] = await Promise.all([
    supabase.from('host_stripe_accounts').select('stripe_account_id, onboarding_complete').eq('user_id', userId).maybeSingle(),
    supabase.from('community_members').select('communities(id, name)').eq('user_id', userId).eq('role', 'admin'),
    supabase.from('profiles').select('display_name').eq('id', userId).single(),
  ]);

  const communityIds = (memberRows ?? []).map((r: any) => r.communities?.id).filter(Boolean);

  const [
    { count: upcomingCount },
    { count: totalOrdersCount },
    { data: recentOrders },
  ] = await Promise.all([
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .in('community_id', communityIds.length ? communityIds : ['none'])
      .gte('starts_at', new Date().toISOString()),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', userId)
      .in('status', ['paid', 'shipped', 'delivered']),
    supabase
      .from('orders')
      .select('id, status, total_cents, created_at')
      .eq('business_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const stripeIncomplete = stripeAccount && !stripeAccount.onboarding_complete;
  const stripeNotStarted = !stripeAccount;
  const displayName = (profile?.display_name as string | null) ?? 'there';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const STATUS_COLORS: Record<string, string> = {
    paid:      'bg-blue-500/15 text-blue-400',
    shipped:   'bg-amber-500/15 text-amber-400',
    delivered: 'bg-emerald-500/15 text-emerald-400',
    refunded:  'bg-red-500/15 text-red-400',
    cancelled: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {displayName} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Here&apos;s what&apos;s happening with your studio today.
        </p>
      </div>

      {/* Alert banners */}
      {(stripeNotStarted || stripeIncomplete) && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">
              {stripeNotStarted
                ? 'Connect Stripe to enable paid events'
                : 'Stripe setup incomplete — paid events locked'}
            </p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              You&apos;ll need this to collect payments from attendees and customers.
            </p>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-amber-500/30 text-amber-300 hover:bg-amber-500/10 shrink-0 text-xs h-8"
          >
            <Link href="/settings">{stripeNotStarted ? 'Connect now' : 'Resume setup'}</Link>
          </Button>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          title="Communities"
          value={memberRows?.length ?? 0}
          description="Communities you manage"
          icon={Users}
          gradient="gradient-purple"
          iconColor="bg-secondary/20 text-secondary"
          href="/community"
        />
        <MetricCard
          title="Upcoming Events"
          value={upcomingCount ?? 0}
          description="Scheduled across your communities"
          icon={Calendar}
          gradient="gradient-pink"
          iconColor="bg-primary/20 text-primary"
          href="/events"
        />
        <MetricCard
          title="Total Orders"
          value={totalOrdersCount ?? 0}
          description="Paid & fulfilled orders"
          icon={ShoppingCart}
          gradient="gradient-green"
          iconColor="bg-emerald-500/20 text-emerald-400"
          href="/orders"
        />
        <MetricCard
          title="Stripe"
          value={
            stripeAccount?.onboarding_complete
              ? 'Connected'
              : stripeAccount
                ? 'Incomplete'
                : 'Not set up'
          }
          description="Payment processing status"
          icon={DollarSign}
          gradient="gradient-amber"
          iconColor="bg-amber-500/20 text-amber-400"
          href="/settings"
          badge={stripeAccount?.onboarding_complete ? '✓ Live' : undefined}
        />
      </div>

      {/* Quick actions + Recent orders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <Card className="border-border/60 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { href: '/events',            label: 'Create Event',      desc: 'Schedule a new event',       icon: Calendar },
              { href: '/products',          label: 'Add Product',       desc: 'List something to sell',     icon: Package },
              { href: '/community',         label: 'Manage Community',  desc: 'Posts & members',            icon: Users },
              { href: '/stripe-onboarding', label: 'Seller Setup',      desc: 'Connect your store',         icon: DollarSign },
            ].map(({ href, label, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/60 transition-colors group"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-none">{label}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{desc}</p>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Recent orders */}
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              Recent Orders
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground hover:text-foreground">
              <Link href="/orders">
                View all <ArrowUpRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {!recentOrders || recentOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 mb-3">
                  <ShoppingCart className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <p className="text-sm text-muted-foreground">No orders yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Orders will appear here once customers purchase
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4 text-xs border-border/60">
                  <Link href="/stripe-onboarding">Set up your store →</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {recentOrders.map((order: any) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/60">
                        <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground font-mono">
                          #{order.id.slice(-8).toUpperCase()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
                          STATUS_COLORS[order.status] ?? STATUS_COLORS.cancelled
                        )}
                      >
                        {order.status}
                      </span>
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        ${(order.total_cents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
