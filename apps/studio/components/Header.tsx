'use client';

import { usePathname } from 'next/navigation';
import { ChevronRight, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PAGE_TITLES: Record<string, { title: string; section?: string }> = {
  '/dashboard':              { title: 'Dashboard' },
  '/events':                 { title: 'Events',            section: 'Menu' },
  '/rooms':                  { title: 'Rooms',             section: 'Menu' },
  '/games':                  { title: 'Games',             section: 'Menu' },
  '/community':              { title: 'Community',         section: 'Menu' },
  '/payouts':                { title: 'Event Payouts',     section: 'Marketplace' },
  '/stripe-onboarding':      { title: 'Sell on Roxy',      section: 'Marketplace' },
  '/products':               { title: 'Products',          section: 'Marketplace' },
  '/orders':                 { title: 'Orders',            section: 'Marketplace' },
  '/seller-payouts':         { title: 'Seller Payouts',    section: 'Marketplace' },
  '/settings':               { title: 'Settings' },
  '/staff':                  { title: 'Overview',          section: 'Staff' },
  '/staff/products':         { title: 'Product Approval',  section: 'Staff' },
  '/staff/email-queue':      { title: 'Email Queue',       section: 'Staff' },
  '/staff/reconciliation':   { title: 'Reconciliation',    section: 'Staff' },
  '/staff/disputes':         { title: 'Disputes',          section: 'Staff' },
};

export function Header() {
  const pathname = usePathname();
  const page = PAGE_TITLES[pathname] ?? { title: 'Studio' };

  return (
    <header className="flex h-16 shrink-0 items-center border-b border-border/60 bg-background/60 backdrop-blur-sm px-6 gap-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm flex-1">
        <span className="text-muted-foreground/60 font-medium">Studio</span>
        {page.section && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-muted-foreground/60">{page.section}</span>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="font-semibold text-foreground">{page.title}</span>
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground relative">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
