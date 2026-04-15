'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const mainNavItems = [
  { href: '/dashboard',      label: 'Dashboard' },
  { href: '/events',         label: 'Events' },
  { href: '/rooms',          label: 'Rooms' },
  { href: '/games',          label: 'Games' },
  { href: '/community',      label: 'Community' },
  { href: '/payouts',        label: 'Payouts' },
  { href: '/stripe-onboarding', label: 'Sell on Roxy' },
  { href: '/products',       label: 'Products' },
  { href: '/orders',         label: 'Orders' },
  { href: '/seller-payouts', label: 'Seller Payouts' },
  { href: '/settings',       label: 'Settings' },
];

const staffNavItems = [
  { href: '/staff',                  label: '⚡ Staff' },
  { href: '/staff/products',         label: '⚡ Product Approval' },
  { href: '/staff/email-queue',      label: '⚡ Email Queue' },
  { href: '/staff/reconciliation',   label: '⚡ Reconciliation' },
  { href: '/staff/disputes',         label: '⚡ Disputes' },
];

export function Sidebar({ isStaff = false }: { isStaff?: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen border-r border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <span className="text-xl font-bold tracking-tight text-primary">🌸 Studio</span>
        <p className="text-xs text-muted-foreground mt-0.5">Host dashboard</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {mainNavItems.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {label}
          </Link>
        ))}

        {isStaff && (
          <>
            <div className="pt-3 pb-1 px-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                Staff
              </p>
            </div>
            {staffNavItems.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'block rounded-md pl-5 pr-3 py-1.5 text-xs font-medium transition-colors',
                  pathname === href
                    ? 'bg-primary/20 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {label}
              </Link>
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
