import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Skeleton } from '@/components/ui/skeleton';

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-10 sm:py-12">
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-md space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
