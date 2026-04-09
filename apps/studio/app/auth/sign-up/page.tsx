import { SignUpForm } from "@/components/sign-up-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">🌸 Roxy Studio</span>
          <p className="text-sm text-muted-foreground mt-1">Create your host account</p>
        </div>
        <SignUpForm />
      </div>
    </div>
  );
}
