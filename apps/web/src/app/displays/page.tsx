import { ADMIN_ROLE_RANK } from '@mirrorfit/types';

import { signOut } from '@/app/login/actions';
import { requireStaff } from '@/lib/auth/staff';
import { createSupabaseServerClient } from '@/lib/supabase/server-client';

import { CreateDisplayForm, IssueCodeForm, RevokeCredentialForm } from './forms';

export const metadata = { title: 'Displays — MirrorFit AI' };
export const dynamic = 'force-dynamic';

function relativeTime(iso: string | null): string {
  if (!iso) {
    // Not "never seen 0 minutes ago". A mirror that has never reported is a
    // different state from one that reported a moment ago.
    return 'never';
  }
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.floor(hours / 24))} d ago`;
}

/**
 * Display and installation management.
 *
 * Functional rather than designed. Phase 13 builds the real dashboard; this
 * exists so a mirror can actually be registered and enrolled, which is what
 * Phase 3 is for.
 *
 * Every query below runs through the RLS-scoped client, so the rows a staff
 * member sees are decided by the database from their session. There is no
 * organization filter in this file, and there should not be one — adding it
 * would imply the caller could change it.
 */
export default async function DisplaysPage() {
  const staff = await requireStaff();
  const supabase = await createSupabaseServerClient();

  const [{ data: shops }, { data: displays }, { data: credentials }] = await Promise.all([
    supabase.from('shops').select('id, name').order('name'),
    supabase
      .from('displays')
      .select('id, name, slug, status, shop_id, last_heartbeat_at, app_version, camera_ok')
      .order('name'),
    supabase
      .from('device_credentials')
      .select('id, display_id, label, issued_at, revoked_at, last_used_at')
      .is('revoked_at', null),
  ]);

  const shopNames = new Map((shops ?? []).map((shop) => [shop.id, shop.name]));
  const liveCredentials = new Map((credentials ?? []).map((cred) => [cred.display_id, cred]));
  const canManage = staff.roleRank >= ADMIN_ROLE_RANK;

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
          <h1 className="text-3xl font-light tracking-tight text-primary">Displays</h1>
          <p className="text-sm text-secondary">
            {staff.email} — {staff.role.replace('_', ' ').toLowerCase()}
            {staff.shopId ? ' (single shop)' : ' (organization-wide)'}
          </p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-muted underline-offset-2 hover:underline">
            Sign out
          </button>
        </form>
      </header>

      {canManage ? (
        <section className="glass space-y-4 rounded-lg p-6">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
            Add a display
          </h2>
          <CreateDisplayForm shops={shops ?? []} />
        </section>
      ) : (
        <p className="text-sm text-muted">
          Your role can view displays but not change them. Ask an administrator to register a
          mirror.
        </p>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
          Registered mirrors
        </h2>

        {(displays ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            No displays yet. A mirror appears here once it is registered, and comes online once a
            technician enrolls it.
          </p>
        ) : (
          <ul className="space-y-3">
            {(displays ?? []).map((display) => {
              const credential = liveCredentials.get(display.id);
              return (
                <li key={display.id} className="glass space-y-3 rounded-lg p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <h3 className="text-lg text-primary">{display.name}</h3>
                      <p className="text-xs text-muted">
                        {shopNames.get(display.shop_id) ?? 'Unknown shop'} · {display.slug}
                      </p>
                    </div>
                    <span className="text-xs uppercase tracking-widest text-secondary">
                      {display.status}
                    </span>
                  </div>

                  <dl className="grid gap-x-8 gap-y-1 text-xs sm:grid-cols-3">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Last heartbeat</dt>
                      <dd className="text-secondary">{relativeTime(display.last_heartbeat_at)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">App version</dt>
                      <dd className="text-secondary">{display.app_version ?? 'unknown'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Camera</dt>
                      <dd className="text-secondary">
                        {/* Three states, not two. Null means the mirror has
                            never told us, which is not the same as a fault. */}
                        {display.camera_ok === null
                          ? 'not reported'
                          : display.camera_ok
                            ? 'ok'
                            : 'fault'}
                      </dd>
                    </div>
                  </dl>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-4 border-t border-white/10 pt-3">
                      {credential ? (
                        <p className="text-xs text-secondary">
                          Enrolled · last used {relativeTime(credential.last_used_at)} ·{' '}
                          <RevokeCredentialForm credentialId={credential.id} />
                        </p>
                      ) : (
                        <IssueCodeForm displayId={display.id} />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
