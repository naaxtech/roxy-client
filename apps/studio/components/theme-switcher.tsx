"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const ICON_SIZE = 14;

const LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const ThemeSwitcher = () => {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // The resolved theme is only known on the client. Rather than rendering
  // nothing until mount (which shifts the sidebar footer), render the control
  // with the neutral "system" icon — the server and the first client render
  // agree, so there is no hydration mismatch and no layout jump.
  useEffect(() => {
    setMounted(true);
  }, []);

  const current = mounted ? (theme ?? "system") : "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Laptop;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Change theme (current: ${LABELS[current] ?? "System"})`}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon size={ICON_SIZE} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => setTheme(value)}
        >
          <DropdownMenuRadioItem className="flex gap-2" value="light">
            <Sun size={ICON_SIZE} aria-hidden="true" />
            <span>Light</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="dark">
            <Moon size={ICON_SIZE} aria-hidden="true" />
            <span>Dark</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="system">
            <Laptop size={ICON_SIZE} aria-hidden="true" />
            <span>System</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ThemeSwitcher };
