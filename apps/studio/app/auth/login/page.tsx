import { Suspense } from 'react';
import { Sparkles } from 'lucide-react';
import { LoginForm } from '@/components/login-form';

export default function Page() {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background glow orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 ring-1 ring-primary/30">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gradient">Roxy Studio</h1>
          <p className="text-sm text-muted-foreground">Sign in to your host dashboard</p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-xl shadow-black/20">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
