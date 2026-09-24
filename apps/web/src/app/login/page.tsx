import { redirect } from 'next/navigation';

import { getStaffContext } from '@/lib/auth/staff';

import { signIn } from './actions';

export const metadata = { title: 'Sign in — MirrorFit AI' };

/**
 * Staff sign-in.
 *
 * Deliberately a plain server-rendered form with no client JavaScript. This
 * is the minimum needed to reach the displays screen in Phase 3; the styled
 * dashboard shell arrives in Phase 13.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getStaffContext()) {
    redirect('/displays');
  }

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
        <h1 className="text-3xl font-light tracking-tight text-primary">Staff sign in</h1>
      </header>

      <form action={signIn} className="glass space-y-4 rounded-lg p-6">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm text-secondary">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded-sm border border-white/15 bg-black/30 px-3 py-2 text-primary outline-none focus:border-accent"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm text-secondary">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-sm border border-white/15 bg-black/30 px-3 py-2 text-primary outline-none focus:border-accent"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            Those credentials were not accepted.
          </p>
        ) : null}

        <button
          type="submit"
          className="w-full rounded-sm bg-accent px-4 py-2 font-medium text-accent-contrast transition-colors hover:bg-accent-strong"
        >
          Sign in
        </button>
      </form>

      <p className="text-xs text-muted">
        Accounts are created by your organization administrator. There is no self-service sign-up.
      </p>
    </main>
  );
}
