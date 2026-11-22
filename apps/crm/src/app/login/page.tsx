'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { changePasswordSchema, loginSchema, type ChangePasswordForm, type LoginForm } from '@kite/shared';
import { ApiError } from '@kite/api-client';
import { Button, Field, Input } from '@/components/ui/core';
import { KiteLogo } from '@/components/kite-logo';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { status, login, changePassword, logout } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: '', password: '', remember: true } });
  const pw = useForm<ChangePasswordForm>({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });

  const onLogin = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.identifier, v.password, !!v.remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    }
  });

  const onChange = pw.handleSubmit(async (v) => {
    setError(null);
    try {
      await changePassword(v.currentPassword, v.newPassword);
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = e.fieldErrors();
        for (const [k, m] of Object.entries(fields)) pw.setError(k as keyof ChangePasswordForm, { message: m });
      }
      setError(e instanceof Error ? e.message : 'Could not change password');
    }
  });

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-night-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <KiteLogo className="size-9" />
          <span className="text-lg font-semibold tracking-tight">Kite Shop CRM</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Every kite, every rupee, accounted for.</h1>
          <p className="mt-4 text-base text-white/70">Live stock, bills from every counter, collections and season reports — built for the Uttarayan rush.</p>
        </div>
        <p className="relative z-10 text-xs text-white/40">Kai po che! 🪁</p>
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[
            ['left-[12%] top-[18%] size-24', '0s'],
            ['right-[14%] top-[30%] size-32', '1.2s'],
            ['left-[38%] bottom-[16%] size-20', '2.1s'],
            ['right-[30%] bottom-[34%] size-14', '0.6s'],
          ].map(([pos, delay]) => (
            <div key={pos} className={`absolute ${pos} animate-kite opacity-25`} style={{ animationDelay: delay }}>
              <KiteLogo className="size-full" />
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <KiteLogo />
            <span className="text-lg font-semibold">Kite Shop CRM</span>
          </div>

          {status === 'must-change-password' ? (
            <form onSubmit={onChange} className="space-y-4" noValidate>
              <div className="mb-2 flex items-center gap-2 text-brand-600">
                <LockKeyhole className="size-5" />
                <h2 className="text-xl font-semibold text-ink-900">Set a new password</h2>
              </div>
              <p className="text-sm text-ink-500">For security, choose your own password before continuing. Use at least 10 characters with letters and numbers.</p>
              <Field label="Current password" error={pw.formState.errors.currentPassword?.message} htmlFor="cur">
                <Input id="cur" type="password" autoComplete="current-password" {...pw.register('currentPassword')} />
              </Field>
              <Field label="New password" error={pw.formState.errors.newPassword?.message} htmlFor="new">
                <Input id="new" type="password" autoComplete="new-password" {...pw.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" error={pw.formState.errors.confirmPassword?.message} htmlFor="conf">
                <Input id="conf" type="password" autoComplete="new-password" {...pw.register('confirmPassword')} />
              </Field>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
              <Button type="submit" className="w-full" size="lg" loading={pw.formState.isSubmitting}>
                Save password
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={logout}>
                Sign out
              </Button>
            </form>
          ) : (
            <form onSubmit={onLogin} className="space-y-4" noValidate>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
                <p className="mt-1 text-sm text-ink-500">Sign in with your username or email.</p>
              </div>
              <Field label="Username or email" error={form.formState.errors.identifier?.message} htmlFor="identifier">
                <Input id="identifier" autoComplete="username" autoFocus {...form.register('identifier')} />
              </Field>
              <Field label="Password" error={form.formState.errors.password?.message} htmlFor="password">
                <div className="relative">
                  <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" {...form.register('password')} />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-600">
                <input type="checkbox" className="size-4 accent-[var(--brand)]" {...form.register('remember')} /> Keep me signed in on this computer
              </label>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
              <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting || status === 'loading'}>
                Sign in
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
