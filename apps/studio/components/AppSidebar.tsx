'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Calendar, Video, Gamepad2, Users, Wallet,
  ShoppingBag, Package, ShoppingCart, DollarSign, Settings,
  Shield, CheckSquare, Mail, RefreshCw, AlertTriangle,
  ChevronRight, LogOut, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const mainNav = [
  { href: '/dashboard',   label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/events',      label: 'Events',         icon: Calendar },
  { href: '/rooms',       label: 'Rooms',          icon: Video },
  { href: '/games',       label: 'Games',          icon: Gamepad2 },
  { href: '/community',   label: 'Community',      icon: Users },
];

const sellerNav = [
  { href: '/stripe-onboarding', label: 'Sell on Roxy',    icon: ShoppingBag },
  { href: '/products',          label: 'Products',         icon: Package },
  { href: '/orders',            label: 'Orders',           icon: ShoppingCart },
  { href: '/seller-payouts',    label: 'Seller Payouts',   icon: DollarSign },
  { href: '/payouts',           label: 'Event Payouts',    icon: Wallet },
];

const staffNav = [
  { href: '/staff',                label: 'Overview',          icon: Shield },
  { href: '/staff/products',       label: 'Product Approval',  icon: CheckSquare },
  { href: '/staff/email-queue',    label: 'Email Queue',       icon: Mail },
  { href: '/staff/reconciliation', label: 'Reconciliation',    icon: RefreshCw },
  { href: '/staff/disputes',       label: 'Disputes',          icon: AlertTriangle },
];

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ElementType;
  pathname: string;
  indent?: boolean;
}

function NavItem({ href, label, icon: Icon, pathname, indent }: NavItemProps) {
  const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
        indent && 'ml-2',
        isActive
          ? 'sidebar-item-active text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
        )}
      />
      <span className="truncate">{label}</span>
      {isActive && (
        <ChevronRight className="ml-auto h-3 w-3 text-primary/60 shrink-0" />
      )}
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        {title}
      </p>
      {children}
    </div>
  );
}

interface AppSidebarProps {
  isStaff?: boolean;
  userEmail?: string;
  userInitials?: string;
}

export function AppSidebar({ isStaff = false, userEmail, userInitials = 'R' }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-border/60 bg-background/80 backdrop-blur-sm">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-border/60 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/30">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-foreground">Roxy Studio</p>
            <p className="text-[10px] text-muted-foreground/70 leading-none mt-0.5">Host dashboard</p>
          </div>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 px-3 py-4">
          <div className="space-y-6">
            <NavSection title="Menu">
              {mainNav.map(item => (
                <NavItem key={item.href} {...item} pathname={pathname} />
              ))}
            </NavSection>

            <Separator className="opacity-30" />

            <NavSection title="Marketplace">
              {sellerNav.map(item => (
                <NavItem key={item.href} {...item} pathname={pathname} />
              ))}
            </NavSection>

            {isStaff && (
              <>
                <Separator className="opacity-30" />
                <NavSection title="Staff">
                  {staffNav.map(item => (
                    <NavItem key={item.href} {...item} pathname={pathname} indent />
                  ))}
                </NavSection>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer — settings + user */}
        <div className="border-t border-border/60 p-3 space-y-1">
          <NavItem href="/settings" label="Settings" icon={Settings} pathname={pathname} />
          <Separator className="opacity-20 my-1" />
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <Avatar className="h-7 w-7 ring-1 ring-primary/30">
              <AvatarImage src={undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-[10px] font-bold">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{userEmail ?? 'Host'}</p>
              <p className="text-[10px] text-muted-foreground/60 leading-none mt-0.5">Signed in</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors">
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </form>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
