import Link from 'next/link';

import { signOut } from '@/app/login/actions';
import { requireStaff } from '@/lib/auth/staff';
import { loadOpsSnapshot } from '@/lib/ops/load-ops-snapshot';

export const metadata = { title: 'Operations — MirrorFit AI' };
export const dynamic = 'force-dynamic';

/**
 * Foundational store-manager operations view.
 *
 * Aggregates kiosk health, session analytics, and inventory distribution from
 * existing tenant-scoped tables. No camera frames, storage paths, or device
 * secrets are rendered.
 */
export default async function OpsPage() {
  const staff = await requireStaff();
  const snapshot = await loadOpsSnapshot(staff);

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
          <h1 className="text-3xl font-light tracking-tight text-primary">
            {snapshot.brand.title}
          </h1>
          <p className="text-sm text-secondary">
            {snapshot.brand.subtitle} · {staff.email} — shop-scoped analytics and kiosk health
            {snapshot.shop_id ? '' : ' (select a shop-scoped staff user for full metrics)'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/displays" className="text-sm text-muted underline-offset-2 hover:underline">
            Displays
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-sm text-muted underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="glass space-y-4 rounded-lg p-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">Kiosk fleet</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {(
            [
              ['Online', snapshot.fleet.online],
              ['Stale', snapshot.fleet.stale],
              ['Offline', snapshot.fleet.offline],
              ['Maintenance', snapshot.fleet.maintenance],
              ['Revoked', snapshot.fleet.revoked],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-widest text-muted">{label}</dt>
              <dd className="text-2xl font-light text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        <ul className="divide-y divide-white/5">
          {snapshot.kiosks.map((kiosk) => (
            <li
              key={kiosk.display_id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div>
                <p className="text-primary">{kiosk.name}</p>
                <p className="text-xs text-muted">
                  camera {kiosk.camera_ok === null ? 'unknown' : kiosk.camera_ok ? 'ok' : 'down'}
                  {kiosk.app_version ? ` · v${kiosk.app_version}` : ''}
                </p>
              </div>
              <p className="text-xs uppercase tracking-[0.2em] text-secondary">{kiosk.health}</p>
            </li>
          ))}
          {snapshot.kiosks.length === 0 ? (
            <li className="py-3 text-sm text-muted">No displays in scope.</li>
          ) : null}
        </ul>
      </section>

      <section className="glass space-y-4 rounded-lg p-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
          Session analytics
        </h2>
        {snapshot.analytics ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">Sessions</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.analytics.session_count}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">Try-on selections</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.analytics.garment_selections}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">Avg duration</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.analytics.average_session_duration_ms === null
                    ? '—'
                    : `${Math.round(snapshot.analytics.average_session_duration_ms / 1000)}s`}
                </dd>
              </div>
            </dl>
            <ul className="space-y-2">
              {snapshot.analytics.category_engagement.map((row) => (
                <li key={row.category} className="flex justify-between text-sm">
                  <span className="text-secondary">{row.category}</span>
                  <span className="text-primary">{row.selections}</span>
                </li>
              ))}
              {snapshot.analytics.category_engagement.length === 0 ? (
                <li className="text-sm text-muted">No garment selections yet.</li>
              ) : null}
            </ul>
            <div className="grid gap-4 sm:grid-cols-3">
              <CountList title="Colors" rows={snapshot.analytics.retail.colors} />
              <CountList title="Sizes" rows={snapshot.analytics.retail.sizes} />
              <CountList title="Most tried" rows={snapshot.analytics.retail.mostTried} />
            </div>
            <p className="text-xs text-muted">
              Selection rate{' '}
              {snapshot.analytics.retail.selectionRate === null
                ? '—'
                : `${Math.round(snapshot.analytics.retail.selectionRate * 100)}% of sessions`}
              . This is try-on engagement, not a checkout.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Analytics require a shop-scoped staff account (or a shop filter) so counts stay
            tenant-isolated.
          </p>
        )}
      </section>

      <section className="glass space-y-4 rounded-lg p-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
          Inventory distribution
        </h2>
        {snapshot.inventory ? (
          <>
            <dl className="grid grid-cols-3 gap-4">
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">Garments</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.inventory.active_garments}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">Variants</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.inventory.active_variants}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted">With overlay</dt>
                <dd className="text-2xl font-light text-primary">
                  {snapshot.inventory.garments_with_overlay}
                </dd>
              </div>
            </dl>
            <ul className="space-y-2">
              {snapshot.inventory.by_category.map((row) => (
                <li key={row.category} className="flex justify-between text-sm">
                  <span className="text-secondary">{row.category}</span>
                  <span className="text-primary">
                    {row.garments} garments · {row.variants} variants · {row.with_overlay} overlays
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Inventory summary needs a shop scope.</p>
        )}
      </section>

      <section className="glass space-y-4 rounded-lg p-6">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
          Plan and GPU quota
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-widest text-muted">Plan</dt>
            <dd className="text-2xl font-light capitalize text-primary">{snapshot.plan}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-muted">Mirrors</dt>
            <dd className="text-2xl font-light text-primary">
              {snapshot.usage.mirrors_online}/{snapshot.limits.mirrors}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-muted">Stills today</dt>
            <dd className="text-2xl font-light text-primary">
              {snapshot.usage.still_jobs_today ?? '—'}/{snapshot.limits.stillJobsPerDay}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-muted">GPU estimate</dt>
            <dd className="text-2xl font-light text-primary">
              {snapshot.usage.gpu_estimate_seconds ?? '—'}s
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted">
          {snapshot.limits.gpuSeconds === 0
            ? 'This plan does not include photorealistic GPU time. The 2D mirror keeps working.'
            : snapshot.usage.stills_allowed === false
              ? `Still jobs are over the ${snapshot.limits.stillJobsPerDay}/day gate. Included GPU time is ${snapshot.limits.gpuSeconds}s. The estimate is 8 seconds per succeeded still, not a measured invoice.`
              : `Included GPU time ${snapshot.limits.gpuSeconds}s. The estimate is 8 seconds per succeeded still, not a measured invoice.`}{' '}
          Enterprise JSON is at /api/ops/enterprise for a signed-in manager.
        </p>
      </section>

      <p className="text-xs text-muted">
        Generated {snapshot.generated_at}. Aggregates only — no camera frames or private asset
        paths.
      </p>
    </main>
  );
}

function CountList({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly { readonly label: string; readonly count: number }[];
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted">{title}</p>
      <ul className="mt-2 space-y-1">
        {rows.slice(0, 5).map((row) => (
          <li key={row.label} className="flex justify-between text-sm">
            <span className="truncate text-secondary">{row.label}</span>
            <span className="text-primary">{row.count}</span>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-muted">—</li> : null}
      </ul>
    </div>
  );
}
