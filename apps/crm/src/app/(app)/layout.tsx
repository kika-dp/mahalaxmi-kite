'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { KiteLogo } from '@/components/kite-logo';
import { useAuth } from '@/lib/auth';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous' || status === 'must-change-password') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <KiteLogo className="size-12 animate-kite" />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
