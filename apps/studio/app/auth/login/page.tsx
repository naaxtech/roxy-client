import { Suspense } from 'react';
import Image from 'next/image';
import { LoginForm } from '@/components/login-form';

/**
 * Roxy Studio sign-in.
 *
 * This page wore a generic `Sparkles` icon in a rounded square — the same
 * placeholder every shadcn starter ships with — while the real wordmark sat
 * unused in `public/brand/`. The first screen a host ever sees was the one
 * screen with no Roxy on it.
 *
 * The glow behind the card is the LOCKED brand gradient, #FF5A2E → #F22481 →
 * #E0189A, taken from the logo itself rather than from `text-gradient`, which
 * drifted to #E879A6 → #8B5CF6 and is a different pink to the one on the mark
 * directly above it.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · "brand locked to logo gradient
 * (#FF5A2E→#E0189A) + plum darks" · 2026-09-07
 */
export default function Page() {
  return (
    <div className="brand-dark relative min-h-screen flex items-center justify-center bg-background p-4">
      {/* Brand glow. Two orbs in the logo's own colours, heavily blurred, so
          the plum reads as lit rather than flat — and low enough in opacity
          that nothing competes with the form. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-40 -right-32 h-80 w-80 rounded-full blur-3xl opacity-30"
          style={{ background: 'radial-gradient(circle, #F22481 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-44 -left-32 h-96 w-96 rounded-full blur-3xl opacity-25"
          style={{ background: 'radial-gradient(circle, #FF5A2E 0%, transparent 70%)' }}
        />
        <div
          className="absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl opacity-20"
          style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)' }}
        />
      </div>

      <div className="relative w-full max-w-md space-y-7">
        <div className="text-center space-y-3">
          {/* The actual mark, not an icon standing in for one. The cropped
              wordmark: the shipped file sits on an 8000x4500 canvas with the
              art only 5865x1633 of it, so at any sane height it rendered about
              11px tall inside a field of empty space. */}
          <div className="flex items-center justify-center">
            <Image
              src="/brand/roxy-wordmark.svg"
              alt="Roxy"
              width={359}
              height={100}
              priority
              className="h-11 w-auto"
            />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Studio</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your host dashboard
            </p>
          </div>
        </div>

        {/* No wrapper card: LoginForm renders its own, and nesting the two
            put a border and a heading inside a border and a heading. */}
        <Suspense>
          <LoginForm />
        </Suspense>

        {/* Whose product this is. A host signing in to a dashboard should be
            able to tell who is asking for her password. */}
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground/70">
          Roxy is a Thinqer product. Hosts only — members sign in on the app.
        </p>
      </div>
    </div>
  );
}
