'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { headerMetaFor } from '@/components/AppSidebar';
import { StudioSearch } from '@/components/StudioSearch';

interface HeaderProps {
  isStaff?: boolean;
  isCore?: boolean;
}

export function Header({ isStaff = false, isCore = false }: HeaderProps) {
  const pathname = usePathname();
  const page = headerMetaFor(pathname);

  return (
    <header className="flex h-16 shrink-0 items-center border-b border-border/60 bg-background/60 backdrop-blur-sm px-6 gap-4">
      <Image
        src="/brand/roxy-logo-primary.svg"
        alt="Roxy"
        width={120}
        height={68}
        className="h-6 w-auto"
      />

      <nav className="flex items-center gap-1.5 text-sm flex-1 min-w-0">
        <span className="text-muted-foreground font-medium">Studio</span>
        {page.section && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span className="text-muted-foreground">{page.section}</span>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="font-semibold text-foreground truncate">{page.title}</span>
      </nav>

      <StudioSearch isStaff={isStaff} isCore={isCore} />
    </header>
  );
}
