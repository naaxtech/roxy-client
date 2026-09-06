'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Calendar, Video, Gamepad2, Users, Wallet,
  ShoppingBag, Package, ShoppingCart, DollarSign, Settings,
  Shield, CheckSquare, Mail, RefreshCw, AlertTriangle, Building2,
  ChevronRight, LogOut, Lightbulb, Bug, UserCheck, Ticket, UserCog,
  Archive, UserPlus, GitPullRequest, Flag, Unlock, Crown, BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/auth/signout-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ThemeSwitcher } from '@/components/theme-switcher';

type NavItemDef = {
  href: string;
  label: string;
  icon: React.ElementType;
  exact?: boolean;
  coreOnly?: boolean;
};

export type NavGroupDef = {
  title: string;
  staff?: boolean;
  items: NavItemDef[];
};

/**
 * Host tools first, then Roxy ops. Section titles are the grouping —
 * labels inside a section drop the repeated prefix (Archive Entries → Entries).
 */
export const NAV_GROUPS: NavGroupDef[] = [
  {
    title: 'Host',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Community',
    items: [
      { href: '/community', label: 'Community', icon: Users, exact: true },
      { href: '/community/members', label: 'Members', icon: UserCog },
      { href: '/invites', label: 'Invite codes', icon: Ticket },
      { href: '/applications', label: 'Applications', icon: UserCheck },
    ],
  },
  {
    title: 'Live',
    items: [
      { href: '/events', label: 'Events', icon: Calendar },
      { href: '/rooms', label: 'Rooms', icon: Video },
      { href: '/games', label: 'Games', icon: Gamepad2 },
    ],
  },
  {
    title: 'Shop',
    items: [
      { href: '/stripe-onboarding', label: 'Sell on Roxy', icon: ShoppingBag },
      { href: '/products', label: 'Products', icon: Package },
      { href: '/orders', label: 'Orders', icon: ShoppingCart },
      { href: '/seller-payouts', label: 'Seller payouts', icon: DollarSign },
      { href: '/payouts', label: 'Event payouts', icon: Wallet },
    ],
  },
  {
    title: 'Roxy',
    staff: true,
    items: [
      { href: '/staff', label: 'Overview', icon: Shield, exact: true },
      { href: '/staff/launch', label: 'Launch access', icon: Unlock },
      { href: '/staff/team', label: 'Roxy team', icon: Crown, coreOnly: true },
    ],
  },
  {
    title: 'Archive',
    staff: true,
    items: [
      { href: '/staff/archive', label: 'Dashboard', icon: Archive, exact: true },
      { href: '/staff/archive/entries', label: 'Entries', icon: BookOpen },
      { href: '/staff/archive/members', label: 'Members', icon: UserPlus },
      { href: '/staff/archive/revisions', label: 'Revisions', icon: GitPullRequest },
      { href: '/staff/archive/reports', label: 'Reports', icon: Flag },
    ],
  },
  {
    title: 'Approvals',
    staff: true,
    items: [
      { href: '/staff/businesses', label: 'Businesses', icon: Building2 },
      { href: '/staff/products', label: 'Products', icon: CheckSquare },
      { href: '/staff/games', label: 'Games', icon: Gamepad2 },
    ],
  },
  {
    title: 'Inbox',
    staff: true,
    items: [
      { href: '/staff/feature-requests', label: 'Feature requests', icon: Lightbulb },
      { href: '/staff/feedback', label: 'Feedback', icon: Bug },
      { href: '/staff/email-queue', label: 'Email queue', icon: Mail },
    ],
  },
  {
    title: 'Money',
    staff: true,
    items: [
      { href: '/staff/reconciliation', label: 'Reconciliation', icon: RefreshCw },
      { href: '/staff/disputes', label: 'Disputes', icon: AlertTriangle },
    ],
  },
];

export function navGroupsFor(role: { isStaff: boolean; isCore: boolean }): NavGroupDef[] {
  return NAV_GROUPS
    .filter((group) => !group.staff || role.isStaff)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.coreOnly || role.isCore),
    }))
    .filter((group) => group.items.length > 0);
}

export function headerMetaFor(pathname: string): { title: string; section?: string } {
  if (pathname === '/settings') return { title: 'Settings' };
  for (const group of NAV_GROUPS) {
    const match = [...group.items]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`)));
    if (match) return { title: match.label, section: group.title };
  }
  return { title: 'Studio' };
}

interface NavItemProps {
  href: string;
  label: string;
  icon: React.ElementType;
  pathname: string;
  exact?: boolean;
}

function NavItem({ href, label, icon: Icon, pathname, exact }: NavItemProps) {
  const isActive =
    pathname === href || (!exact && href !== '/dashboard' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
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
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-primary/60 shrink-0" />
      )}
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

interface AppSidebarProps {
  isStaff?: boolean;
  isCore?: boolean;
  userEmail?: string;
  userInitials?: string;
}

export function AppSidebar({ isStaff = false, isCore = false, userEmail, userInitials = 'R' }: AppSidebarProps) {
  const pathname = usePathname();
  const groups = navGroupsFor({ isStaff, isCore });

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="flex h-16 items-center gap-3 border-b border-border/60 px-5">
          <Image
            src="/brand/roxy-logo-primary.svg"
            alt="Roxy"
            width={120}
            height={68}
            priority
            className="h-8 w-auto"
          />
          <p className="text-[10px] text-muted-foreground leading-none">Host dashboard</p>
        </div>

        <ScrollArea className="flex-1 px-3 py-4">
          <div className="space-y-5">
            {groups.map((group, index) => (
              <div key={group.title} className="space-y-5">
                {index > 0 && group.staff && !groups[index - 1]?.staff ? (
                  <Separator className="opacity-30" />
                ) : null}
                <NavSection title={group.title}>
                  {group.items.map((item) => (
                    <NavItem key={item.href} {...item} pathname={pathname} />
                  ))}
                </NavSection>
              </div>
            ))}
          </div>
        </ScrollArea>

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
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                {isCore ? 'Roxy core' : isStaff ? 'Staff' : 'Signed in'}
              </p>
            </div>
            <ThemeSwitcher />
            <Tooltip>
              <TooltipTrigger asChild>
                <form action={signOutAction}>
                  <button type="submit" aria-label="Sign out" className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
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
