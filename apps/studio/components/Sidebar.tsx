'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/events',    label: 'Events' },
  { href: '/rooms',     label: 'Rooms' },
  { href: '/games',     label: 'Games' },
  { href: '/community', label: 'Community' },
  { href: '/payouts',   label: 'Payouts' },
  { href: '/settings',  label: 'Settings' },
];

export function Sidebar({ isStaff = false }: { isStaff?: boolean }) {
  const pathname = usePathname();
  const items = isStaff
    ? [...navItems, { href: '/staff', label: '⚡ Staff' }]
    : navItems;

  return (
    <aside className="w-56 min-h-screen border-r border-border bg-card flex flex-col">
      <div className="p-6 border-b border-border">
        <span className="text-xl font-bold tracking-tight text-primary">🌸 Studio</span>
        <p className="text-xs text-muted-foreground mt-0.5">Host dashboard</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {items.map(({ href, label }) => (
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
      </nav>
    </aside>
  );
}
